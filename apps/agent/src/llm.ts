// The only file that knows which model provider we use. Everything else talks to the `LLM`
// interface: "call exactly one of these tools" and "return JSON matching this schema".
// Validation (Zod, one re-prompt on malformed output) and usage metering wrap any provider.
import { GoogleGenAI, FunctionCallingConfigMode } from "@google/genai";
import pRetry, { AbortError } from "p-retry";
import { z } from "zod";
import { config } from "./config.js";
import { clip, span } from "./telemetry.js";

export type ToolDecl = { name: string; description: string; schema: z.ZodObject };
export type LLMUsage = { model: string; inputTokens: number; outputTokens: number };

export type ToolRequest = { system: string; prompt: string; tools: ToolDecl[]; purpose: string };
export type JsonRequest = { system: string; prompt: string; schema: z.ZodType; purpose: string; model?: string };

/** A provider: raw calls, no validation. */
export interface LLM {
  callTool(req: ToolRequest): Promise<{ name: string; args: unknown; usage: LLMUsage }>;
  json(req: JsonRequest): Promise<{ value: unknown; usage: LLMUsage }>;
}

export class MalformedOutputError extends Error {}

/** Zod -> plain JSON Schema that Gemini accepts. */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) if (k !== "$schema" && k !== "additionalProperties") out[k] = strip(val);
      return out;
    }
    return v;
  };
  return strip(z.toJSONSchema(schema, { io: "input" })) as Record<string, unknown>;
}

// ---- Gemini ---------------------------------------------------------------

export function geminiLLM(): LLM {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !config.model) throw new Error("Set GEMINI_API_KEY and GEMINI_MODEL in .env (see .env.example)");
  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: 120_000 } });

  // Transient provider errors (429, 5xx, network) are retried with backoff; anything else is not.
  const call = <T>(fn: () => Promise<T>) => pRetry(async () => {
    try { return await fn(); } catch (e) {
      const status = (e as { status?: number }).status;
      if (status && status < 500 && status !== 429) throw new AbortError(e as Error);
      throw e;
    }
  }, { retries: 3, minTimeout: 1000, factor: 2 });

  const usageOf = (model: string, u: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } | undefined): LLMUsage => ({
    model, inputTokens: u?.promptTokenCount ?? 0, outputTokens: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0),
  });

  return {
    async callTool(req) {
      const res = await call(() => ai.models.generateContent({
        model: config.model,
        contents: req.prompt,
        config: {
          systemInstruction: req.system,
          toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } },
          tools: [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: toJsonSchema(t.schema) })) }],
        },
      }));
      const fc = res.functionCalls?.[0];
      if (!fc?.name) throw new MalformedOutputError(`Model returned no function call: ${clip(res.text ?? "", 300)}`);
      return { name: fc.name, args: fc.args ?? {}, usage: usageOf(config.model, res.usageMetadata) };
    },
    async json(req) {
      const model = req.model ?? config.model;
      const res = await call(() => ai.models.generateContent({
        model,
        contents: req.prompt,
        config: { systemInstruction: req.system, responseMimeType: "application/json", responseJsonSchema: toJsonSchema(req.schema) },
      }));
      let value: unknown;
      try { value = JSON.parse(res.text ?? ""); } catch { throw new MalformedOutputError(`Not JSON: ${clip(res.text ?? "", 300)}`); }
      return { value, usage: usageOf(model, res.usageMetadata) };
    },
  };
}

// ---- Validation + metering (provider-independent) ------------------------

export type Meter = (u: LLMUsage) => void;

/** Ask for exactly one tool call; validate its args; re-prompt once on malformed output. */
export async function decide(llm: LLM, req: ToolRequest, meter: Meter): Promise<{ name: string; args: Record<string, unknown> }> {
  let prompt = req.prompt;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const out = await span(`llm.${req.purpose}`, "LLM", { "gen_ai.operation.name": "chat", "gen_ai.request.model": config.model, "input.value": clip(prompt), attempt }, async (s) => {
      try {
        const r = await llm.callTool({ ...req, prompt });
        meter(r.usage);
        s.setAttributes({
          "gen_ai.usage.input_tokens": r.usage.inputTokens, "gen_ai.usage.output_tokens": r.usage.outputTokens,
          "llm.token_count.prompt": r.usage.inputTokens, "llm.token_count.completion": r.usage.outputTokens,
          "output.value": JSON.stringify({ name: r.name, args: r.args }),
        });
        return r;
      } catch (e) {
        if (e instanceof MalformedOutputError) return { error: e.message };
        throw e;
      }
    });
    let problem: string;
    if ("error" in out) problem = out.error;
    else {
      const tool = req.tools.find((t) => t.name === out.name);
      if (!tool) problem = `Unknown tool "${out.name}".`;
      else {
        const parsed = tool.schema.safeParse(out.args);
        if (parsed.success) return { name: out.name, args: parsed.data as Record<string, unknown> };
        problem = `Arguments for ${out.name} are invalid: ${z.prettifyError(parsed.error)}`;
      }
    }
    if (attempt === 2) throw new MalformedOutputError(problem);
    prompt = `${req.prompt}\n\nYOUR PREVIOUS REPLY WAS REJECTED: ${problem}\nCall exactly one of the declared tools with valid arguments.`;
  }
  throw new MalformedOutputError("unreachable");
}

/** Ask for JSON matching a schema; validate; re-prompt once. */
export async function structured<S extends z.ZodType>(llm: LLM, req: Omit<JsonRequest, "schema"> & { schema: S }, meter: Meter): Promise<z.infer<S>> {
  let prompt = req.prompt;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const model = req.model ?? config.model;
    const out = await span(`llm.${req.purpose}`, "LLM", { "gen_ai.operation.name": "chat", "gen_ai.request.model": model, "input.value": clip(prompt), attempt }, async (s) => {
      try {
        const r = await llm.json({ ...req, prompt });
        meter(r.usage);
        s.setAttributes({
          "gen_ai.usage.input_tokens": r.usage.inputTokens, "gen_ai.usage.output_tokens": r.usage.outputTokens,
          "llm.token_count.prompt": r.usage.inputTokens, "llm.token_count.completion": r.usage.outputTokens,
          "output.value": clip(JSON.stringify(r.value)),
        });
        return r;
      } catch (e) {
        if (e instanceof MalformedOutputError) return { error: e.message };
        throw e;
      }
    });
    let problem: string;
    if ("error" in out) problem = out.error;
    else {
      const parsed = req.schema.safeParse(out.value);
      if (parsed.success) return parsed.data;
      problem = z.prettifyError(parsed.error);
    }
    if (attempt === 2) throw new MalformedOutputError(`${req.purpose}: ${problem}`);
    prompt = `${req.prompt}\n\nYOUR PREVIOUS REPLY WAS REJECTED: ${problem}\nReturn JSON that matches the schema exactly.`;
  }
  throw new MalformedOutputError("unreachable");
}

export function costUsd(u: { inputTokens: number; outputTokens: number }): number {
  return (u.inputTokens * config.priceIn + u.outputTokens * config.priceOut) / 1_000_000;
}
