// Everything read from the environment, in one place. Credentials are read only by `secret()`,
// which only the login tool calls; nothing here is ever put into a prompt.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
export const PLAYBOOK_DIR = join(REPO_ROOT, "playbook");
export const RUNS_DIR = process.env.CLERK_RUNS_DIR ?? join(REPO_ROOT, "runs");

export const config = {
  baseUrl: process.env.MOCK_BASE_URL ?? "http://localhost:4000",
  model: process.env.GEMINI_MODEL ?? "",
  verifierModel: process.env.GEMINI_VERIFIER_MODEL || process.env.GEMINI_MODEL || "",
  maxSteps: Number(process.env.CLERK_MAX_STEPS ?? 40),
  apiPort: Number(process.env.AGENT_PORT ?? 4100),
  headless: process.env.CLERK_HEADED !== "1",
  chromiumPath: process.env.CHROMIUM_PATH || undefined,
  /** USD per 1M tokens. Set these to your pinned model's list price. */
  priceIn: Number(process.env.GEMINI_PRICE_IN_PER_M ?? 0.3),
  priceOut: Number(process.env.GEMINI_PRICE_OUT_PER_M ?? 2.5),
  phoenixUrl: process.env.PHOENIX_URL ?? "http://localhost:6006",
  tracing: process.env.CLERK_TRACING === "1",
};

export type System = "portal" | "erp";

/** Only the login tool may call this. */
export function secret(system: System): { user: string; pass: string } {
  const u = system === "portal" ? process.env.PORTAL_USER : process.env.ERP_USER;
  const p = system === "portal" ? process.env.PORTAL_PASS : process.env.ERP_PASS;
  if (!u || !p) throw new Error(`Missing ${system.toUpperCase()}_USER / ${system.toUpperCase()}_PASS in .env`);
  return { user: u, pass: p };
}
