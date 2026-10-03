// Gemini via @google/genai: forced function calling (mode ANY) and JSON-schema structured output.
import { GoogleGenAI, FunctionCallingConfigMode } from "@google/genai";
import pRetry, { AbortError } from "p-retry";
import { config } from "../config.js";
import { clip } from "../telemetry.js";
import { MalformedOutputError, toJsonSchema, type LLM, type LLMUsage } from "./common.js";

export function geminiLLM(model = config.model): LLM {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !model) throw new Error("Set GEMINI_API_KEY and GEMINI_MODEL in .env (see .env.example)");
  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: 120_000 } });

  // Transient provider errors (429, 5xx, network) are retried with backoff; anything else is not.
  const call = <T>(fn: () => Promise<T>) => pRetry(async () => {
    try { return await fn(); } catch (e) {
      const status = (e as { status?: number }).status;
      if (status && status < 500 && status !== 429) throw new AbortError(e as Error);
      throw e;
    }
  }, { retries: 3, minTimeout: 1000, factor: 2 });

  const usageOf = (m: string, u: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } | undefined): LLMUsage => ({
    model: m, inputTokens: u?.promptTokenCount ?? 0, outputTokens: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0),
  });

  return {
    async callTool(req) {
      const res = await call(() => ai.models.generateContent({
        model,
        contents: req.prompt,
        config: {
          systemInstruction: req.system,
          toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } },
          tools: [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: toJsonSchema(t.schema) })) }],
        },
      }));
      const fc = res.functionCalls?.[0];
      if (!fc?.name) throw new MalformedOutputError(`Model returned no function call: ${clip(res.text ?? "", 300)}`);
      return { name: fc.name, args: fc.args ?? {}, usage: usageOf(model, res.usageMetadata) };
    },
    async json(req) {
      const m = req.model ?? model;
      const res = await call(() => ai.models.generateContent({
        model: m,
        contents: req.prompt,
        config: { systemInstruction: req.system, responseMimeType: "application/json", responseJsonSchema: toJsonSchema(req.schema) },
      }));
      let value: unknown;
      try { value = JSON.parse(res.text ?? ""); } catch { throw new MalformedOutputError(`Not JSON: ${clip(res.text ?? "", 300)}`); }
      return { value, usage: usageOf(m, res.usageMetadata) };
    },
  };
}
