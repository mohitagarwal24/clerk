// Runs every held-out case through the same engine (loop, gate, verifier) with the code frozen.
// A simulated human approves every held write and answers questions from the case, so a policy
// violation by the agent shows up as a failed case rather than being caught by a person.
//   pnpm evals            all cases          pnpm evals E3 E5    some cases
// Needs the mock apps running (pnpm dev:mock) and a model configured in .env (LLM_* or GEMINI_*).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EvalCase, type EvalResult } from "../packages/shared/src/index.js";
import { config, REPO_ROOT } from "../apps/agent/src/config.js";
import { matches, normNumber, sameValue } from "../apps/agent/src/compare.js";
import { startRun } from "../apps/agent/src/run.js";
import { erpRows } from "../apps/agent/src/erp-read.js";

const DIR = join(REPO_ROOT, "evals");
const base = config.baseUrl;

function mentionsNumber(text: string, target: string): boolean {
  const want = normNumber(target);
  return (text.match(/[₹]?\s?\d[\d,]*(\.\d+)?/g) ?? []).some((t) => normNumber(t.replace(/^₹\s?/, "")) === want);
}

async function main() {
  const only = process.argv.slice(2);
  const cases = EvalCase.array().parse(JSON.parse(readFileSync(join(DIR, "cases.json"), "utf8"))).filter((c) => !only.length || only.includes(c.id));
  if (!(await fetch(`${base}/__health`).then((r) => r.ok).catch(() => false))) throw new Error(`Mock apps not reachable at ${base}. Run pnpm dev:mock first.`);

  const results: EvalResult[] = [];
  const save = () => {
    const ranAt = new Date().toISOString();
    writeFileSync(join(DIR, "results.json"), JSON.stringify({ ranAt, model: config.model, results }, null, 2));
    writeFileSync(join(DIR, "results.md"), renderMarkdown(results, ranAt));
  };

  for (const c of cases) {
    await fetch(`${base}/__reset?reseed=1`, { method: "POST" });
    console.log(`\n${c.id} · ${c.request}  (chaos ${c.chaos})`);
    const t0 = Date.now();
    const run = startRun({
      request: c.request, chaos: c.chaos,
      approver: async (r) => { console.log(`   gate: ${r.method} ${r.path} → auto-approved`); return { approve: true, note: "eval: simulated human" }; },
      answerer: async (q) => { const a = c.answer ?? "I can't confirm that. Please stop and leave it for me."; console.log(`   asked: ${q.question} → "${a}"`); return a; },
    });
    run.bus.subscribe((e) => { if (e.type === "action") process.stdout.write(`   #${e.action.step} ${e.action.tag} ${e.action.tool}${e.action.ok ? "" : " ✗"}\n`); });
    const s = await run.done;

    const reasons: string[] = [];
    const p = c.pass;
    if (p.status && !p.status.includes(s.status)) reasons.push(`status ${s.status}${s.stopReason ? ` (${s.stopReason})` : ""}`);
    if (p.verified && !s.verification?.passed) reasons.push("verification did not pass");
    if (p.asked && s.questions.length === 0) reasons.push("never asked the user");
    const writes = s.approvals.filter((a) => a.decision?.approve).length;
    if (p.no_writes && writes > 0) reasons.push(`${writes} ERP write(s) went through`);
    if (p.answer_contains) {
      const text = `${s.finish?.summary ?? ""} ${(s.finish?.answers ?? []).map((a) => a.value).join(" ")}`;
      if (!mentionsNumber(text, p.answer_contains)) reasons.push(`answer does not state ${p.answer_contains}`);
    }
    for (const chk of p.erp ?? []) {
      const rows = (await erpRows(chk.resource)).filter((r) => matches(r, chk.where, {}));
      if (!rows.length) reasons.push(`no ${chk.resource} row for ${chk.where.map((w) => w.value).join(",")}`);
      else if (!rows.every((r) => sameValue(r[chk.field], chk.value))) reasons.push(`${chk.where.map((w) => w.value).join(",")} ${chk.field} = ${rows.map((r) => r[chk.field]).join(",")}, want ${chk.value}`);
    }
    const r: EvalResult = {
      id: c.id, request: c.request, tag: c.tag, expect: c.expect, runId: s.id, status: s.status,
      pass: reasons.length === 0, reasons, steps: s.step, recoveries: s.recoveries.length, costUsd: s.usage.costUsd, ms: Date.now() - t0,
    };
    results.push(r);
    console.log(`   ${r.pass ? "PASS" : "FAIL"} · ${s.status} · ${s.step} steps · ${r.recoveries} recoveries · $${r.costUsd.toFixed(4)}${reasons.length ? ` · ${reasons.join("; ")}` : ""}`);
    save();
  }
  await fetch(`${base}/__reset?reseed=1`, { method: "POST" });
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed. Results in evals/results.md`);
}

function renderMarkdown(results: EvalResult[], ranAt: string): string {
  const passed = results.filter((r) => r.pass).length;
  const steps = results.map((r) => r.steps).sort((a, b) => a - b);
  const cost = results.reduce((s, r) => s + r.costUsd, 0);
  return [
    `# Eval results`, "", `Ran ${ranAt} · model \`${config.model}\` · frozen code, held-out requests`, "",
    `**${passed}/${results.length} passed** · median ${steps[Math.floor(steps.length / 2)] ?? 0} steps · ${results.reduce((s, r) => s + r.recoveries, 0)} recoveries · $${(cost / Math.max(1, results.length)).toFixed(4)} per run`, "",
    "| ID | Request | Tag | Expected | Result | Status | Steps | Recoveries | Cost | Run |", "|---|---|---|---|---|---|---|---|---|---|",
    ...results.map((r) => `| ${r.id} | ${r.request} | ${r.tag} | ${r.expect} | ${r.pass ? "PASS" : `FAIL: ${r.reasons.join("; ")}`} | ${r.status} | ${r.steps} | ${r.recoveries} | $${r.costUsd.toFixed(4)} | ${r.runId} |`),
    "",
  ].join("\n");
}

await main();
