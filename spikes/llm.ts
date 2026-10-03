// Model spike: which model handles Clerk's calls well? For each model it runs
//   1. planning: pick skills + GoalSpec for T1 (schema-valid? criteria use $source checks?)
//   2. one real step: the Globex invoice list (does it open INV-1042, not superseded INV-1041?)
//   pnpm spike:llm --list [filter]        models the endpoint serves
//   pnpm spike:llm [model ...]            test these (default: LLM_MODEL / GEMINI_MODEL)
import type { GoalSpec } from "../packages/shared/src/index.js";
import { config } from "../apps/agent/src/config.js";
import { createLLM, decide, type LLM } from "../apps/agent/src/llm.js";
import { listModels } from "../apps/agent/src/providers/openai.js";
import { loadPlaybook } from "../apps/agent/src/skills.js";
import { pickSkills, understand } from "../apps/agent/src/understand.js";
import { STEP_SYSTEM, stepPrompt } from "../apps/agent/src/loop.js";
import { declarations } from "../apps/agent/src/tools/registry.js";
import { newState } from "../apps/agent/src/memory.js";

const REQUEST = "Find the latest invoice from Globex, extract the amount and due date, enter it into the ERP, and tell me when it's done.";

// Real snapshot of the mock portal's Globex invoice list (captured from the running app).
const SNAPSHOT = `- generic [active] [ref=f1e1]:
  - generic [ref=f1e2]:
    - generic [ref=f1e3]: Acme Corp Supplier Invoice Portal
    - generic [ref=f1e4]:
      - text: Signed in as ap.clerk |
      - button "Sign out" [ref=f1e6] [cursor=pointer]
  - navigation [ref=f1e7]:
    - link "Vendors" [ref=f1e8] [cursor=pointer]:
      - /url: /portal/vendors
    - link "All invoices" [ref=f1e9] [cursor=pointer]:
      - /url: /portal/invoices
  - main [ref=f1e10]:
    - heading "Invoices from Globex Corporation" [level=1] [ref=f1e11]
    - paragraph [ref=f1e12]: Newest upload first. Amounts are on the invoice PDF.
    - table [ref=f1e13]:
      - rowgroup [ref=f1e14]:
        - row [ref=f1e15]:
          - columnheader "Invoice No." [ref=f1e16]
          - columnheader "Invoice date" [ref=f1e17]
          - columnheader "Uploaded" [ref=f1e18]
          - columnheader "Status" [ref=f1e19]
          - columnheader "Remarks" [ref=f1e20]
        - row [ref=f1e21]:
          - cell [ref=f1e22]:
            - link "INV-1041" [ref=f1e23] [cursor=pointer]:
              - /url: /portal/invoices/INV-1041
          - cell "26/09/2026" [ref=f1e24]
          - cell "30/09/2026 16:40" [ref=f1e25]
          - cell "Superseded" [ref=f1e26]
          - cell "Replaced by INV-1042 (corrected quantities). Do not process." [ref=f1e28]
        - row [ref=f1e29]:
          - cell [ref=f1e30]:
            - link "INV-1042" [ref=f1e31] [cursor=pointer]:
              - /url: /portal/invoices/INV-1042
          - cell "28/09/2026" [ref=f1e32]
          - cell "28/09/2026 10:14" [ref=f1e33]
          - cell "Open" [ref=f1e34]
          - cell [ref=f1e36]
        - row [ref=f1e37]:
          - cell [ref=f1e38]:
            - link "INV-0987" [ref=f1e39] [cursor=pointer]:
              - /url: /portal/invoices/INV-0987
          - cell "20/08/2026" [ref=f1e40]
          - cell "21/08/2026 09:02" [ref=f1e41]
          - cell "Paid" [ref=f1e42]
          - cell [ref=f1e44]
  - contentinfo [ref=f1e45]: Acme Corp internal systems. Mock environment for the Clerk prototype.`;

const FALLBACK_GOAL: GoalSpec = {
  intent: "The latest valid Globex invoice is entered in the ERP as a bill", entities: [{ name: "vendor", value: "Globex" }],
  source_fields: [{ key: "invoice_no", description: "Invoice number" }, { key: "amount", description: "Total payable" }, { key: "due_date", description: "Payment due date" }],
  success_criteria: [{ id: "C1", check: "One Globex bill with the PDF's invoice number", source: "ERP record", kind: "record", resource: "bills",
    where: [{ field: "invoice_no", op: "=", value: "$source.invoice_no" }], expect_count: "1" }],
  open_questions: [], plan: ["Open Globex invoices in the portal", "Pick the latest valid invoice", "Read the PDF", "Check the ERP for duplicates", "Create the bill", "Finish"],
};

type Row = { model: string; plan: string; step: string; secs: string; tokens: number };

async function testModel(model: string): Promise<Row> {
  console.log(`\n=== ${model} (${config.provider}) ===`);
  let tokens = 0;
  const meter = (u: { inputTokens: number; outputTokens: number }) => { tokens += u.inputTokens + u.outputTokens; };
  const llm: LLM = createLLM(model);
  const skills = loadPlaybook();
  const t0 = Date.now();
  let goal = FALLBACK_GOAL;
  let chosen = ["systems", "invoice-entry", "approvals"];
  let plan = "";
  try {
    chosen = await pickSkills(llm, meter, REQUEST, skills);
    goal = await understand(llm, meter, REQUEST, skills, chosen);
    const usesSource = goal.success_criteria.some((c) => JSON.stringify(c).includes("$source."));
    plan = `ok · ${goal.success_criteria.length} criteria${usesSource ? " · $source" : " · NO $source"}`;
    console.log(`skills: ${chosen.join(", ")}`);
    for (const c of goal.success_criteria) console.log(`  ${c.id} [${c.kind}] ${c.check}  where=${JSON.stringify(c.where ?? [])} count=${c.expect_count ?? "-"} fields=${JSON.stringify(c.expect_fields ?? [])}`);
    console.log(`plan: ${goal.plan.join(" → ")}`);
  } catch (e) {
    plan = `FAIL: ${(e as Error).message.slice(0, 160)}`;
    console.log(plan);
  }

  let step = "";
  try {
    const state = newState("spike", REQUEST, "off", 40);
    Object.assign(state, { goal, skillsLoaded: chosen, step: 2, planRevision: 1,
      recent: ["#1 open_url(url=\"/portal/vendors/V-001/invoices\") → opened /portal/vendors/V-001/invoices", "#2 login(system=\"portal\") → signed in to portal, now at /portal/vendors/V-001/invoices"] });
    state.step = 3;
    const obs = { url: `${config.baseUrl}/portal/vendors/V-001/invoices`, title: "Globex Corporation invoices", status: 200, method: "GET", errors: [], snapshot: SNAPSHOT, truncated: false };
    const call = await decide(llm, { system: STEP_SYSTEM, prompt: stepPrompt(state, skills, obs, "login → ok: signed in to portal"), tools: declarations(), purpose: "spike_step" }, meter);
    console.log(`step: ${call.name}(${JSON.stringify(call.args)})`);
    const ref = String(call.args.ref ?? call.args.url ?? "");
    step = ref === "f1e31" || ref.includes("INV-1042") ? "ok · opened INV-1042"
      : ref === "f1e23" || ref.includes("INV-1041") ? "WRONG · picked superseded INV-1041"
      : `? ${call.name}(${ref})`;
  } catch (e) {
    step = `FAIL: ${(e as Error).message.slice(0, 160)}`;
    console.log(step);
  }
  return { model, plan, step, secs: ((Date.now() - t0) / 1000).toFixed(1), tokens };
}

const args = process.argv.slice(2);
if (args[0] === "--list") {
  if (config.provider !== "openai") throw new Error("--list needs LLM_PROVIDER=openai (LLM_BASE_URL + LLM_API_KEY)");
  const ids = await listModels();
  const filter = args[1]?.toLowerCase();
  const shown = ids.filter((id) => (filter ? id.toLowerCase().includes(filter) : !/embed|rerank|vision|vlm|parse|guard|safety|reward|clip|whisper|tts|asr|retriev|nv-ingest/i.test(id)));
  console.log(`${shown.length} of ${ids.length} models at ${config.llmBaseUrl}${filter ? ` matching "${filter}"` : " (chat-like)"}:\n${shown.join("\n")}`);
} else {
  const models = args.length ? args : [config.model];
  if (!models[0]) throw new Error("Pass model IDs, or set LLM_MODEL / GEMINI_MODEL in .env");
  const rows: Row[] = [];
  for (const m of models) rows.push(await testModel(m));
  console.log("\n| model | planning | first step | seconds | tokens |\n|---|---|---|---|---|");
  for (const r of rows) console.log(`| ${r.model} | ${r.plan} | ${r.step} | ${r.secs} | ${r.tokens} |`);
}
