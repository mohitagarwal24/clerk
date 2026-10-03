// Any OpenAI-compatible chat-completions API: NVIDIA build.nvidia.com (default), Cerebras, Groq,
// OpenRouter, Ollama. Plain fetch, no SDK.
//
// Two portability choices, because servers and models differ:
// - Structured output is a forced call to one "submit" tool carrying the schema, not a JSON mode.
//   Anything that supports tool calling supports this.
// - tool_choice falls back when a server rejects it: named/"required" -> "auto". With "auto" a
//   model may answer in text; we then parse JSON out of the text, else llm.ts re-prompts once.
// - Models fall back too: when the endpoint says a model is gone (404/410) or it stops responding,
//   the next one in LLM_FALLBACK_MODELS is used for the rest of the process.
import { config } from "../config.js";
import { clip } from "../telemetry.js";
import { MalformedOutputError, toJsonSchema, type LLM, type LLMUsage, type ToolDecl } from "./common.js";

type ToolChoice = "required" | "auto" | { type: "function"; function: { name: string } };
type ToolCall = { function?: { name?: string; arguments?: string | Record<string, unknown> } };
type ChatResponse = {
  choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export class ProviderError extends Error {
  constructor(readonly status: number, body: string) {
    super(`LLM API HTTP ${status}: ${clip(body, 400)}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Free tiers limit requests per minute per account, so pace every call in this process.
let nextSlot = 0;
async function pace(rpm: number) {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + 60_000 / rpm;
  if (at > now) await sleep(at - now);
}

/** Servers that rejected "required" or a named tool_choice; remembered for the process. */
const noForcedChoice = new Set<string>();

/** Models this process stopped using, and why. */
export const retiredModels = new Map<string, string>();

class UnresponsiveError extends Error {}

/** A model the endpoint no longer serves (retired, or not available to this account). */
export const isModelGone = (e: unknown) =>
  e instanceof ProviderError && (e.status === 404 || e.status === 410 || /end of life|model .*(not found|does not exist)/i.test(e.message));

export function parseLooseJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try { return JSON.parse(t); } catch { /* try the outermost object */ }
  const i = t.indexOf("{");
  const j = t.lastIndexOf("}");
  if (i >= 0 && j > i) {
    try { return JSON.parse(t.slice(i, j + 1)); } catch { /* fall through */ }
  }
  throw new MalformedOutputError(`Not JSON: ${clip(text, 300)}`);
}

export function openaiLLM(opts: { model?: string; baseUrl?: string; apiKey?: string; rpm?: number } = {}): LLM {
  const model = opts.model ?? config.model;
  const base = opts.baseUrl ?? config.llmBaseUrl;
  const apiKey = opts.apiKey ?? process.env.LLM_API_KEY ?? "";
  const rpm = opts.rpm ?? config.llmRpm;
  if (!model) throw new Error("Set LLM_MODEL in .env (see .env.example; `pnpm spike:llm` lists models)");
  if (!apiKey && !/localhost|127\.0\.0\.1/.test(base)) throw new Error("Set LLM_API_KEY in .env (see .env.example)");

  /** POST with pacing; 429 / 5xx / network errors retried with Retry-After or exponential backoff. */
  async function post(body: Record<string, unknown>): Promise<ChatResponse> {
    for (let attempt = 0; ; attempt++) {
      await pace(rpm);
      let res: Response;
      try {
        res = await fetch(`${base}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(config.llmTimeoutMs),
        });
      } catch (e) {
        if (attempt >= 1) throw new UnresponsiveError(`no response from ${String(body.model)}: ${(e as Error).message}`);
        await sleep(Math.min(30_000, 2000 * 2 ** attempt));
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 5) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep(retryAfter > 0 ? retryAfter * 1000 : Math.min(30_000, 2000 * 2 ** attempt));
        continue;
      }
      const text = await res.text();
      if (!res.ok) throw new ProviderError(res.status, text);
      try { return JSON.parse(text) as ChatResponse; } catch { throw new ProviderError(res.status, `non-JSON body: ${text}`); }
    }
  }

  /** Try the requested model, then each fallback, skipping models already found gone. */
  async function withFallback(m: string, send: (model: string) => Promise<ChatResponse>): Promise<{ r: ChatResponse; used: string }> {
    const chain = [m, ...config.llmFallbackModels.filter((x) => x !== m)];
    let last: unknown;
    for (const candidate of chain) {
      if (retiredModels.has(candidate)) continue;
      try {
        return { r: await send(candidate), used: candidate };
      } catch (e) {
        if (!isModelGone(e) && !(e instanceof UnresponsiveError)) throw e;
        retiredModels.set(candidate, (e as Error).message);
        console.error(`[clerk] model ${candidate} unavailable (${clip((e as Error).message, 160)}); trying the next fallback`);
        last = e;
      }
    }
    throw last ?? new Error(`No usable model: ${chain.join(", ")} are all unavailable. Set LLM_MODEL / LLM_FALLBACK_MODELS.`);
  }

  /** Send with the strongest tool_choice the server accepts. */
  async function withTools(m: string, system: string, prompt: string, tools: ToolDecl[], forced: ToolChoice): Promise<ChatResponse> {
    const body = {
      model: m,
      max_tokens: config.llmMaxTokens,
      messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
      tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: toJsonSchema(t.schema) } })),
    };
    const key = `${base}|${m}`;
    if (!noForcedChoice.has(key)) {
      try {
        return await post({ ...body, tool_choice: forced });
      } catch (e) {
        if (!(e instanceof ProviderError && e.status >= 400 && e.status < 500 && /tool_choice|required|named|function/i.test(e.message))) throw e;
        noForcedChoice.add(key); // this server/model cannot force a tool; ask nicely instead
      }
    }
    return post({ ...body, tool_choice: "auto" });
  }

  const usageOf = (m: string, r: ChatResponse): LLMUsage => ({ model: m, inputTokens: r.usage?.prompt_tokens ?? 0, outputTokens: r.usage?.completion_tokens ?? 0 });

  const firstCall = (r: ChatResponse) => {
    const fn = r.choices?.[0]?.message?.tool_calls?.[0]?.function;
    if (!fn?.name) return null;
    const a = fn.arguments;
    return { name: fn.name, args: typeof a === "string" ? (a.trim() ? parseLooseJson(a) : {}) : a ?? {} };
  };

  return {
    async callTool(req) {
      const { r, used } = await withFallback(model, (m) => withTools(m, req.system, req.prompt, req.tools, "required"));
      const call = firstCall(r);
      if (!call) throw new MalformedOutputError(`Model returned no tool call: ${clip(r.choices?.[0]?.message?.content ?? "", 300)}`);
      return { ...call, usage: usageOf(used, r) };
    },
    async json(req) {
      const m = req.model ?? model;
      const submit = { name: "submit", description: "Submit your answer. The arguments are the answer.", schema: req.schema } as ToolDecl;
      const { r, used } = await withFallback(m, (x) => withTools(x, req.system, `${req.prompt}\n\nCall the submit tool with your answer.`, [submit], { type: "function", function: { name: "submit" } }));
      const call = firstCall(r);
      const value = call ? call.args : parseLooseJson(r.choices?.[0]?.message?.content ?? "");
      return { value, usage: usageOf(used, r) };
    },
  };
}

/** GET /models: what the endpoint serves (used by the spike to pick a model). */
export async function listModels(base = config.llmBaseUrl, apiKey = process.env.LLM_API_KEY ?? ""): Promise<string[]> {
  const res = await fetch(`${base}/models`, { headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {} });
  if (!res.ok) throw new ProviderError(res.status, await res.text());
  const data = (await res.json()) as { data?: { id: string }[] };
  return (data.data ?? []).map((m) => m.id).sort();
}
