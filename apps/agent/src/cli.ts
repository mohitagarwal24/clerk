// CLI runner: same engine, terminal approver and answerer.
//   pnpm cli "<request>" [--chaos off|default|rerun] [--yes] [--answer "<text>"] [--max-steps N]
import { createInterface } from "node:readline/promises";
import { CHAOS_PRESETS, type ApprovalDecision, type ChaosPreset, type RunEvent } from "@clerk/shared";
import { changedFields } from "./gate.js";
import { startRun } from "./run.js";
import { traceUrl } from "./telemetry.js";

const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`, bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  blue: (s: string) => `\x1b[34m${s}\x1b[0m`, amber: (s: string) => `\x1b[33m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`, red: (s: string) => `\x1b[31m${s}\x1b[0m`,
};

function parseArgs(argv: string[]) {
  const out = { request: "", chaos: "off" as ChaosPreset, yes: false, answer: undefined as string | undefined, maxSteps: undefined as number | undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--chaos") out.chaos = argv[++i] as ChaosPreset;
    else if (a === "--yes" || a === "-y") out.yes = true;
    else if (a === "--answer") out.answer = argv[++i];
    else if (a === "--max-steps") out.maxSteps = Number(argv[++i]);
    else if (a !== "--") out.request += (out.request ? " " : "") + a;
  }
  if (!out.request) throw new Error('Usage: pnpm cli "<request>" [--chaos off|default|rerun] [--yes] [--answer "<text>"]');
  if (!(CHAOS_PRESETS as readonly string[]).includes(out.chaos)) throw new Error(`--chaos must be one of ${CHAOS_PRESETS.join(", ")}`);
  return out;
}

const TAG_COLOR: Record<string, (s: string) => string> = { RECOVER: c.amber, ADAPT: c.amber, ASK: c.amber, DECIDE: c.bold, PLAN: c.dim, ACT: c.blue };

export function printEvent(e: RunEvent) {
  switch (e.type) {
    case "run_started": console.log(c.bold(`\n${e.runId} · chaos ${e.chaos} · "${e.request}"`)); break;
    case "goal":
      console.log(c.dim(`[PLAN r${e.revision}] skills: ${e.skills.join(", ")}`));
      console.log(`  ${c.bold("Done means")}`);
      for (const cr of e.goal.success_criteria) console.log(`   ${cr.id} ${cr.check} ${c.dim(`[${cr.kind} · ${cr.source}]`)}`);
      console.log(`  ${c.bold("Plan")}`);
      e.goal.plan.forEach((p, i) => console.log(`   ${i + 1}. ${p}`));
      if (e.goal.open_questions.length) console.log(`  ${c.amber("Open questions:")} ${e.goal.open_questions.join(" | ")}`);
      break;
    case "action": {
      const a = e.action;
      const tag = (TAG_COLOR[a.tag] ?? ((s: string) => s))(a.tag.padEnd(7));
      const args = Object.entries(a.args).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ");
      console.log(`#${String(a.step).padStart(2, "0")} ${tag} ${a.tool}(${args.length > 110 ? args.slice(0, 110) + "…" : args})`);
      if (a.why) console.log(c.dim(`           why: ${a.why}`));
      console.log(`           ${a.ok ? "→" : c.red("✗")} ${a.result}`);
      break;
    }
    case "recovery": console.log(c.amber(`           ↻ RECOVER ${e.recovery.kind}: ${e.recovery.detail}`)); break;
    case "injection_flag": console.log(c.red(`           ⚑ injection flagged in ${e.where}: "${e.text.slice(0, 120)}…"`)); break;
    case "status": if (!["EXECUTING"].includes(e.status)) console.log(c.dim(`   · ${e.status}${e.note ? ` (${e.note})` : ""}`)); break;
    case "verification": {
      const v = e.verification;
      console.log(c.bold(`\nVerification (attempt ${v.attempt}): ${v.passed ? c.green("PASSED") : c.red("FAILED")}`));
      if (v.source) console.log(c.dim(`  source re-check: ${v.source.ok ? "ok" : "NOT OK"} · ${v.source.document ?? ""} · ${JSON.stringify(v.source.values)}`));
      for (const cr of v.criteria) console.log(`  ${cr.pass ? c.green("PASS") : c.red("FAIL")} ${cr.id} ${cr.check}\n       expected ${cr.expected} · found ${cr.found} · ${c.dim(cr.how)}${cr.note ? c.dim(` · ${cr.note}`) : ""}`);
      if (v.readback) console.log(c.dim(`  read-back (evidence only): ${v.readback.comment}`));
      break;
    }
    case "finished": {
      const color = e.status === "DONE" ? c.green : e.status === "FAILED" ? c.red : c.amber;
      console.log(color(c.bold(`\n${e.status}`)) + ` · ${e.summary}`);
      break;
    }
    case "error": console.log(c.red(`error: ${e.message}`)); break;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const run = startRun({
    request: args.request,
    chaos: args.chaos,
    maxSteps: args.maxSteps,
    approver: async (req): Promise<ApprovalDecision> => {
      const changed = changedFields(req.fields, req.previous);
      console.log(c.amber(c.bold(`\n⏸  NETWORK GATE · ${req.method} ${req.path} held (step ${req.step})${req.previous ? " · re-approval" : ""}`)));
      for (const f of req.fields) console.log(`     ${f.name.padEnd(14)} ${changed.includes(f.name) ? c.amber(f.value + "  (changed)") : f.value}`);
      if (args.yes) { console.log(c.dim("     auto-approved (--yes)")); return { approve: true }; }
      for (;;) {
        const a = (await rl.question("   Approve and submit? [y]es / [n]o / [e]dit: ")).trim().toLowerCase();
        if (a === "y" || a === "yes") return { approve: true };
        if (a === "n" || a === "no") return { approve: false, note: (await rl.question("   Reason (optional): ")) || undefined };
        if (a === "e" || a === "edit") {
          const name = (await rl.question("   Field to edit: ")).trim();
          const value = await rl.question(`   New value for ${name}: `);
          return { approve: true, fields: { [name]: value } };
        }
      }
    },
    answerer: async (q) => {
      console.log(c.amber(c.bold(`\n?  ${q.question}`)));
      q.options?.forEach((o, i) => console.log(`   ${i + 1}. ${o}`));
      if (args.answer) { console.log(c.dim(`   answered from --answer: ${args.answer}`)); return args.answer; }
      const a = (await rl.question("   Your answer: ")).trim();
      const n = Number(a);
      return q.options && Number.isInteger(n) && n >= 1 && n <= q.options.length ? q.options[n - 1]! : a;
    },
  });
  run.bus.subscribe(printEvent);
  process.on("SIGINT", () => { console.log(c.amber("\nstopping…")); run.stop(); });
  const state = await run.done;
  rl.close();
  console.log(c.dim(`\nEvidence: runs/${state.id}/  (summary.md, actions.jsonl, screenshots/, verification.json)`));
  console.log(c.dim(`Usage: ${state.usage.calls} model calls · ${state.usage.inputTokens + state.usage.outputTokens} tokens · est. $${state.usage.costUsd.toFixed(4)}`));
  const t = traceUrl(state.traceId);
  if (t) console.log(c.dim(`Trace: ${t}`));
  process.exit(state.status === "FAILED" ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
