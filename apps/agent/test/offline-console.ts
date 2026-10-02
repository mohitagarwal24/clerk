// Offline console demo: the real mock apps + agent API, with the scripted model from the tests
// instead of Gemini. Lets you click through the console (T1 under chaos, both approvals, report)
// without an API key or token spend. Only T1 is scripted.
//   pnpm offline   then open http://localhost:5174
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MOCK_BASE_URL = "http://localhost:4600";
process.env.CLERK_RUNS_DIR = join(tmpdir(), "clerk-offline-runs");
Object.assign(process.env, { PORTAL_USER: "ap.clerk", PORTAL_PASS: "portal-demo-pass", ERP_USER: "ap.clerk", ERP_PASS: "erp-demo-pass", GEMINI_MODEL: "scripted (offline demo)" });

const { serve } = await import("@hono/node-server");
const { startMock } = await import("./mock-server.js");
const { scriptedLLM } = await import("./scripted-llm.js");
const { invoiceEntryPolicy, jsonFor, T1_GOAL } = await import("./fixtures.js");
const { createServer } = await import("../src/server.js");

await startMock(4600);
let policy = invoiceEntryPolicy();
const llm = scriptedLLM({
  step: (p) => { if (p.url === "about:blank") policy = invoiceEntryPolicy(); return policy(p); },
  json: jsonFor(T1_GOAL, ["systems", "invoice-entry", "approvals"]),
});
serve({ fetch: createServer({ llm }).fetch, port: 4610 }, () => console.log("Offline agent API on :4610 (scripted model, T1 only); mock apps on :4600"));
