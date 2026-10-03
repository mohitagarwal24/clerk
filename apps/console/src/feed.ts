// Turns the raw action log into a plain-language activity feed for the person who asked for
// the work. Mechanics (refs, tool names, bookkeeping calls) stay available in technical mode.
import type { ActionRecord } from "@clerk/shared";
import type { RunView } from "./api.js";
import { approvalDone, changedLabels } from "./ui.js";

export type FeedEntry =
  | { kind: "system"; key: string; label: string }
  | { kind: "step"; key: string; step: number; text: string; detail?: string; quiet: boolean; failed: boolean; techOnly: boolean; actions: ActionRecord[] }
  | { kind: "note"; key: string; step: number; tone: "wait" | "stop" | "ok" | "agent"; text: string; detail?: string };

const SYSTEMS: [RegExp, string][] = [[/\/portal(\/|$)/, "Vendor Portal"], [/\/erp(\/|$)/, "ERP"]];
const systemOf = (url?: string) => (url ? SYSTEMS.find(([re]) => re.test(new URL(url, "http://x").pathname))?.[1] : undefined);

const sentence = (s: string) => {
  const t = s.trim().replace(/\.$/, "");
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
};

function describe(a: ActionRecord, system?: string): { text: string; detail?: string; quiet?: boolean; techOnly?: boolean } {
  const arg = (k: string) => String(a.args[k] ?? "");
  switch (a.tool) {
    case "login": return { text: `Signed in to the ${a.args.system === "erp" ? "ERP" : "Vendor Portal"}`, quiet: true };
    case "remember": return { text: `Noted ${arg("key")}: ${arg("value")}`, techOnly: true };
    case "finish": return { text: "Handed the result over for an independent check", techOnly: true };
    case "ask_user": return { text: "Asked you a question", techOnly: true };
    case "read_skill": return { text: `Looked up the company rule on ${arg("name").replace(/-/g, " ")}`, quiet: true };
    case "replan": return { text: `Changed the plan: ${arg("reason")}` };
    case "download": return { text: sentence(a.why) || "Downloaded a document", detail: a.result.match(/downloaded (\S+)/)?.[1] };
    case "read_pdf": return { text: sentence(a.why) || `Read ${arg("file")}`, detail: arg("file") };
    default: return { text: sentence(a.why) || `${a.tool} on the ${system ?? "page"}` };
  }
}

const RECOVERY_TEXT: Record<string, string> = {
  transient: "The system returned an error. Clerk waited a moment and tried again.",
  stale_ref: "The page changed while Clerk was working on it. It looked again and carried on.",
};

export function buildFeed(v: RunView): FeedEntry[] {
  const out: FeedEntry[] = [];
  let system: string | undefined;

  const notesFor = (step: number) => {
    for (const [i, r] of v.recoveries.entries()) {
      if (r.step === step) out.push({ kind: "note", key: `r${i}`, step, tone: "wait", text: RECOVERY_TEXT[r.kind] ?? `Recovered from a problem: ${r.detail}`, detail: r.detail });
    }
    for (const [i, f] of v.injections.entries()) {
      if (f.step === step) out.push({ kind: "note", key: `i${i}`, step, tone: "stop", text: "This document contains an instruction aimed at AI agents. Clerk ignored it and flagged it for you.", detail: f.text });
    }
    for (const a of v.approvals) {
      const d = v.resolved[a.id];
      if (a.step !== step || !d) continue;
      out.push(d.approve
        ? { kind: "note", key: a.id, step, tone: "ok", text: a.previous
            ? `You approved the corrected version (${changedLabels(a).join(", ") || "same values"} changed)${d.fields ? " with your edits" : ""}.`
            : `You approved ${approvalDone(a)}${d.fields ? " with your edits" : ""}.` }
        : { kind: "note", key: a.id, step, tone: "stop", text: `You rejected ${approvalDone(a)}.`, detail: d.note });
    }
    for (const q of v.questions) {
      if (q.step !== step) continue;
      out.push({ kind: "note", key: q.id, step, tone: "wait", text: `Clerk asked: ${q.question}`, detail: q.id in v.answers ? `You answered: ${v.answers[q.id]}` : undefined });
    }
  };

  // Questions asked before any browser action (step 0) still belong in the feed.
  notesFor(0);

  for (let i = 0; i < v.actions.length; i++) {
    const a = v.actions[i]!;
    const sys = systemOf(a.url) ?? system;
    if (sys && sys !== system) {
      out.push({ kind: "system", key: `s${a.step}`, label: sys });
      system = sys;
    }
    // Consecutive successful form fills on the same page read as one thing a person did.
    if ((a.tool === "type" || a.tool === "select") && a.ok) {
      const run = [a];
      while (v.actions[i + 1] && ["type", "select"].includes(v.actions[i + 1]!.tool) && v.actions[i + 1]!.ok && v.actions[i + 1]!.url === a.url) run.push(v.actions[++i]!);
      const values = run.map((r) => String(r.args.text ?? r.args.option ?? ""));
      const isForm = run.length > 1 || /new|edit|status/.test(a.url ?? "");
      out.push({
        kind: "step", key: `a${a.step}`, step: a.step, quiet: false, failed: false, techOnly: false, actions: run,
        text: isForm ? "Filled in the form" : sentence(a.why) || "Typed into the page", detail: values.join("  ·  "),
      });
      for (const r of run) notesFor(r.step);
      continue;
    }
    const d = describe(a, system);
    // A failed click that recovery explains (stale page) needs no "didn't work" suffix; the note says it.
    const explained = v.recoveries.some((r) => r.step === a.step);
    out.push({ kind: "step", key: `a${a.step}`, step: a.step, text: d.text, detail: d.detail, quiet: !!d.quiet, failed: !a.ok && !explained, techOnly: !!d.techOnly, actions: [a] });
    notesFor(a.step);
  }

  if (v.verification) {
    const passed = v.verification.criteria.filter((c) => c.pass).length;
    const total = v.verification.criteria.length;
    out.push({ kind: "note", key: "verify", step: Infinity, tone: v.verification.passed ? "ok" : "stop",
      text: v.verification.passed ? `Checked independently: all ${total} checks passed.` : `Checked independently: ${passed} of ${total} checks passed.` });
  }
  return out;
}

/** One short line for "what is Clerk doing right now". */
export function currentActivity(v: RunView): string {
  const last = [...v.actions].reverse().find((a) => !["remember"].includes(a.tool));
  if (!last) return v.goal ? "Planning the work" : "Reading your request";
  return describe(last).text;
}
