// The only place that chooses a model provider. Everything else talks to the `LLM` interface:
// "call exactly one of these tools" and "return JSON matching this schema".
// Validation (Zod, one re-prompt on malformed output) and usage metering wrap any provider.
//   providers/gemini.ts  Gemini via @google/genai
//   providers/openai.ts  any OpenAI-compatible API (NVIDIA build.nvidia.com, Cerebras, Groq, Ollama...)
import { z } from "zod";
import { config } from "./config.js";
import { clip, span } from "./telemetry.js";
import { MalformedOutputError, type JsonRequest, type LLM, type LLMUsage, type ToolRequest } from "./providers/common.js";
import { geminiLLM } from "./providers/gemini.js";
import { openaiLLM } from "./providers/openai.js";

export { MalformedOutputError, toJsonSchema } from "./providers/common.js";
export type { JsonRequest, LLM, LLMUsage, ToolDecl, ToolRequest } from "./providers/common.js";

/** The provider configured in .env. Throws a readable error if its key or model is missing. */
export function createLLM(model?: string): LLM {
  return config.provider === "openai" ? openaiLLM({ model }) : geminiLLM(model);
}

export function llmConfigured(): boolean {
  if (!config.model) return false;
  return config.provider === "openai" ? !!process.env.LLM_API_KEY || /localhost|127\.0\.0\.1/.test(config.llmBaseUrl) : !!process.env.GEMINI_API_KEY;
}

// ---- Validation + metering (provider-independent) ------------------------

export type Meter = (u: LLMUsage) => void;

/** Ask for exactly one tool call; validate its args; re-prompt once on malformed output. */
export async function decide(llm: LLM, req: ToolRequest, meter: Meter): Promise<{ name: string; args: Record<string, unknown> }> {
  let prompt = req.prompt;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const out = await span(`llm.${req.purpose}`, "LLM", { "gen_ai.operation.name": "chat", "gen_ai.system": config.provider, "gen_ai.request.model": config.model, "input.value": clip(prompt), attempt }, async (s) => {
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
    const out = await span(`llm.${req.purpose}`, "LLM", { "gen_ai.operation.name": "chat", "gen_ai.system": config.provider, "gen_ai.request.model": model, "input.value": clip(prompt), attempt }, async (s) => {
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
