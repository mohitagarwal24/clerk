// Everything read from the environment, in one place. Credentials are read only by `secret()`,
// which only the login tool calls; nothing here is ever put into a prompt.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
export const PLAYBOOK_DIR = join(REPO_ROOT, "playbook");
export const RUNS_DIR = process.env.CLERK_RUNS_DIR ?? join(REPO_ROOT, "runs");

/**
 * Model provider. "openai" = any OpenAI-compatible chat-completions API (NVIDIA build.nvidia.com,
 * Cerebras, Groq, OpenRouter, Ollama). Defaults to "openai" when LLM_API_KEY is set, else Gemini.
 */
export type Provider = "gemini" | "openai";
const provider: Provider = (process.env.LLM_PROVIDER as Provider | undefined) ?? (process.env.LLM_API_KEY ? "openai" : "gemini");
const model = (provider === "openai" ? process.env.LLM_MODEL : process.env.GEMINI_MODEL) ?? "";

export const config = {
  baseUrl: process.env.MOCK_BASE_URL ?? "http://localhost:4000",
  provider,
  model,
  verifierModel: (provider === "openai" ? process.env.LLM_VERIFIER_MODEL : process.env.GEMINI_VERIFIER_MODEL) || model,
  /** OpenAI-compatible endpoint settings. */
  llmBaseUrl: (process.env.LLM_BASE_URL ?? "https://integrate.api.nvidia.com/v1").replace(/\/$/, ""),
  llmRpm: Number(process.env.LLM_RPM ?? 35),
  llmMaxTokens: Number(process.env.LLM_MAX_TOKENS ?? 4096),
  maxSteps: Number(process.env.CLERK_MAX_STEPS ?? 40),
  apiPort: Number(process.env.AGENT_PORT ?? 4100),
  headless: process.env.CLERK_HEADED !== "1",
  chromiumPath: process.env.CHROMIUM_PATH || undefined,
  /** USD per 1M tokens. Set these to your pinned model's list price. */
  priceIn: Number((provider === "openai" ? process.env.LLM_PRICE_IN_PER_M : process.env.GEMINI_PRICE_IN_PER_M) ?? (provider === "openai" ? 0 : 0.3)),
  priceOut: Number((provider === "openai" ? process.env.LLM_PRICE_OUT_PER_M : process.env.GEMINI_PRICE_OUT_PER_M) ?? (provider === "openai" ? 0 : 2.5)),
  phoenixUrl: process.env.PHOENIX_URL ?? "http://localhost:6006",
  tracing: process.env.CLERK_TRACING === "1",
};

export type System = "portal" | "erp";

/** Credentials for code that signs in: the login tool, the verifier and server-side ERP reads. Never put in a prompt. */
export function secret(system: System): { user: string; pass: string } {
  const u = system === "portal" ? process.env.PORTAL_USER : process.env.ERP_USER;
  const p = system === "portal" ? process.env.PORTAL_PASS : process.env.ERP_PASS;
  if (!u || !p) throw new Error(`Missing ${system.toUpperCase()}_USER / ${system.toUpperCase()}_PASS in .env`);
  return { user: u, pass: p };
}
