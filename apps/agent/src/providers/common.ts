// What every model provider shares: the request shapes, the raw interface, and schema conversion.
import { z } from "zod";

export type ToolDecl = { name: string; description: string; schema: z.ZodObject };
export type LLMUsage = { model: string; inputTokens: number; outputTokens: number };

export type ToolRequest = { system: string; prompt: string; tools: ToolDecl[]; purpose: string };
export type JsonRequest = { system: string; prompt: string; schema: z.ZodType; purpose: string; model?: string };

/** A provider: raw calls, no validation (llm.ts validates and re-prompts). */
export interface LLM {
  callTool(req: ToolRequest): Promise<{ name: string; args: unknown; usage: LLMUsage }>;
  json(req: JsonRequest): Promise<{ value: unknown; usage: LLMUsage }>;
}

/** The model answered, but not with what we asked for. Triggers one re-prompt. */
export class MalformedOutputError extends Error {}

/** Zod -> plain JSON Schema that Gemini and OpenAI-compatible servers accept. */
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
