// End to end with everything real except the model: Chromium, the mock portal + ERP with chaos,
// the network approval gate, recovery, the verifier (own context, ERP JSON, code comparisons).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ApprovalRequest, GoalSpec } from "@clerk/shared";
import { invoiceEntryPolicy, jsonFor, T1_GOAL } from "./fixtures.js";
import { startRun } from "../src/run.js";
import { runDir } from "../src/memory.js";
import { call, scriptedLLM } from "./scripted-llm.js";
import { startMock } from "./mock-server.js";

let mock: Awaited<ReturnType<typeof startMock>>;
beforeAll(async () => { mock = await startMock(); });
afterAll(async () => { await mock.close(); });
beforeEach(() => mock.reseed());

describe("end to end (scripted model, everything else real)", () => {
  it("T1 with chaos on: recovers from 500, stale ref and date validation; gate re-asks; verifier passes", async () => {
    const llm = scriptedLLM({ step: invoiceEntryPolicy(), json: jsonFor(T1_GOAL, ["systems", "invoice-entry", "approvals"]) });
    const asked: ApprovalRequest[] = [];
    const run = startRun({
      request: "Find the latest invoice from Globex, extract the amount and due date, enter it into the ERP, and tell me when it's done.",
      chaos: "default", llm, approver: async (r) => { asked.push(r); return { approve: true }; }, answerer: async () => "n/a",
    });
    const s = await run.done;

    expect(s.stopReason).toBeUndefined();
    expect(s.status).toBe("DONE");
    expect(s.verification?.passed).toBe(true);
    expect(s.verification?.criteria.map((c) => c.pass)).toEqual([true, true, true, true]);
    expect(s.verification?.source?.values).toMatchObject({ invoice_no: "INV-1042", amount: "48,250.00", due_date: "2026-10-30" });

    // Two held writes: the ISO date (rejected by the ERP's validation), then the corrected one, which shows what changed.
    expect(asked).toHaveLength(2);
    expect(asked[0]!.path).toBe("/erp/bills");
    expect(asked[0]!.fields).toContainEqual({ name: "due_date", value: "2026-10-30" });
    expect(asked[1]!.previous).toContainEqual({ name: "due_date", value: "2026-10-30" });
    expect(asked[1]!.fields).toContainEqual({ name: "due_date", value: "30/10/2026" });

    const kinds = s.recoveries.map((r) => r.kind);
    expect(kinds).toContain("transient");
    expect(kinds).toContain("stale_ref");
    expect(s.injectionFlags.length).toBeGreaterThan(0);

    const bills = mock.db.prepare("SELECT * FROM bills WHERE invoice_no = 'INV-1042'").all() as { amount: string; due_date: string }[];
    expect(bills).toHaveLength(1);
    expect(bills[0]).toMatchObject({ amount: "48250.00", due_date: "2026-10-30" });

    // Credentials never reach the model.
    for (const p of llm.prompts) { expect(p).not.toContain("erp-demo-pass"); expect(p).not.toContain("portal-demo-pass"); }
    // Evidence bundle.
    const dir = runDir(s.id);
    for (const f of ["summary.md", "actions.jsonl", "events.jsonl", "state.json", "verification.json"]) expect(existsSync(join(dir, f))).toBe(true);
    expect(readFileSync(join(dir, "summary.md"), "utf8")).toContain("PASS");
  });

  it("rerun preset: the bill already exists, so the agent stops and nothing is written", async () => {
    const llm = scriptedLLM({ step: invoiceEntryPolicy(), json: jsonFor(T1_GOAL, ["systems", "invoice-entry"]) });
    const asked: ApprovalRequest[] = [];
    const s = await startRun({ request: "Enter the latest Globex invoice into the ERP.", chaos: "rerun", llm,
      approver: async (r) => { asked.push(r); return { approve: true }; }, answerer: async () => "n/a" }).done;
    expect(s.status).toBe("NEEDS_ATTENTION");
    expect(s.finish?.outcome).toBe("blocked");
    expect(asked).toHaveLength(0);
    expect(mock.db.prepare("SELECT COUNT(*) AS n FROM bills WHERE invoice_no = 'INV-1042'").get()).toEqual({ n: 1 });
  });

  it("policy gate: asks before a bank change, stops when not verified, writes nothing", async () => {
    const goal: GoalSpec = {
      intent: "Globex bank details are changed only after verified call-back", entities: [{ name: "vendor", value: "Globex" }], source_fields: [],
      success_criteria: [
        { id: "C1", check: "Asked a human to confirm call-back verification", source: "playbook vendor-changes", kind: "asked_user" },
        { id: "C2", check: "No ERP write without verification", source: "playbook vendor-changes", kind: "no_writes" },
      ],
      open_questions: ["Has the change been verified by call-back?"], plan: ["Ask the user for call-back verification", "Stop if not verified"],
    };
    const llm = scriptedLLM({
      step: (p) => p.memory.includes("user_answer")
        ? call("finish", { outcome: "blocked", summary: "Bank details not changed: call-back verification was not confirmed.", answers: [], sources: [] })
        : call("ask_user", { question: "Has the new bank account been verified by a call-back to Globex's number on file?", options: ["Yes, verified", "No"] }),
      json: jsonFor(goal, ["vendor-changes", "approvals"]),
    });
    const s = await startRun({ request: "Globex says their bank details changed, update the vendor record.", chaos: "default", llm,
      approver: async () => ({ approve: true }), answerer: async () => "No" }).done;
    expect(s.status).toBe("NEEDS_ATTENTION");
    expect(s.questions).toHaveLength(1);
    expect(s.verification?.criteria.every((c) => c.pass)).toBe(true);
  });

  it("stops on a loop: the same action three times in a row", async () => {
    const llm = scriptedLLM({ step: () => call("open_url", { url: "/portal/vendors" }), json: jsonFor(T1_GOAL, ["systems"]) });
    const s = await startRun({ request: "Do something", chaos: "off", llm, approver: async () => ({ approve: true }), answerer: async () => "" }).done;
    expect(s.status).toBe("NEEDS_ATTENTION");
    expect(s.stopReason).toMatch(/Loop detected/);
    expect(s.step).toBe(3);
  });
});
