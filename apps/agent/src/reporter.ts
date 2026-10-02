// Evidence bundle in runs/<id>/: summary.md, verification.json, state.json (actions.jsonl,
// events.jsonl and screenshots/ are written as the run goes).
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunState } from "@clerk/shared";
import { saveState } from "./memory.js";
import { traceUrl } from "./telemetry.js";

const inr = (n: number) => n.toFixed(4);

export function renderSummary(s: RunState): string {
  const v = s.verification;
  const lines = [
    `# ${s.id}: ${s.status}`,
    "",
    `**Request:** ${s.request}`,
    `**Chaos:** ${s.chaos} · **Steps:** ${s.step}/${s.maxSteps} · **Started:** ${s.startedAt} · **Ended:** ${s.endedAt ?? "-"}`,
    "",
    "## Summary",
    s.finish?.summary ?? s.stopReason ?? "(no summary)",
  ];
  if (s.stopReason) lines.push("", `**Stopped because:** ${s.stopReason}`);
  if (s.finish?.answers.length) lines.push("", "## Answers", ...s.finish.answers.map((a) => `- ${a.key}: ${a.value}`));
  if (v) {
    lines.push("", `## Verification (attempt ${v.attempt}): ${v.passed ? "PASSED" : "FAILED"}`, "",
      "| ID | Check | Expected | Found | How checked | Result |", "|---|---|---|---|---|---|",
      ...v.criteria.map((c) => `| ${c.id} | ${c.check} | ${c.expected} | ${c.found} | ${c.how} | ${c.pass ? "PASS" : "FAIL"}${c.note ? ` (${c.note})` : ""} |`));
    if (v.source) lines.push("", `Source re-check: ${v.source.ok ? "ok" : "NOT OK"} · ${v.source.document ?? ""} · ${v.source.note}`,
      `Re-read values: ${Object.entries(v.source.values).map(([k, x]) => `${k}=${x}`).join(", ") || "none"}`);
    if (v.readback) lines.push("", `LLM read-back (evidence only): ${v.readback.comment}`);
  }
  if (s.recoveries.length) lines.push("", "## Recoveries", ...s.recoveries.map((r) => `- step ${r.step} · ${r.kind}: ${r.detail}`));
  if (s.injectionFlags.length) lines.push("", "## Prompt-injection flags (treated as data, not followed)", ...s.injectionFlags.map((f) => `- step ${f.step} · ${f.where}: "${f.text}"`));
  if (s.approvals.length) lines.push("", "## Approvals (network gate)", ...s.approvals.map((a) =>
    `- step ${a.step} · ${a.method} ${a.path} · ${a.decision ? (a.decision.approve ? "approved" : "rejected") : "pending"} · ${(a.sent ?? a.fields).map((f) => `${f.name}=${f.value}`).join(", ")}`));
  if (s.questions.length) lines.push("", "## Questions to the user", ...s.questions.map((q) => `- step ${q.step}: ${q.question} → ${q.answer ?? "(no answer)"}`));
  lines.push("", "## Usage", `${s.usage.calls} model calls · ${s.usage.inputTokens} input + ${s.usage.outputTokens} output tokens · est. $${inr(s.usage.costUsd)}`);
  const t = traceUrl(s.traceId);
  if (t) lines.push(`Trace: ${t}`);
  lines.push("", "## Evidence", "- actions.jsonl: every tool call with args, result and screenshot", "- events.jsonl: the full event stream", "- screenshots/: one per observed step (passwords masked)", "- verification.json", "- downloads/: source documents the agent read");
  return lines.join("\n") + "\n";
}

export function writeReport(s: RunState, dir: string) {
  saveState(s);
  writeFileSync(join(dir, "summary.md"), renderSummary(s));
  if (s.verification) writeFileSync(join(dir, "verification.json"), JSON.stringify(s.verification, null, 2));
}
