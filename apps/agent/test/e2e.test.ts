// End to end with everything real except the model: Chromium, the mock portal + ERP with chaos,
// the network approval gate, recovery, the verifier (own context, ERP JSON, code comparisons).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ApprovalRequest, GoalSpec } from "@clerk/shared";
import { startRun } from "../src/run.js";
import { runDir } from "../src/memory.js";
import { call, PromptView, readInvoiceDocs, scriptedLLM } from "./scripted-llm.js";
import { startMock } from "./mock-server.js";

let mock: Awaited<ReturnType<typeof startMock>>;
beforeAll(async () => { mock = await startMock(); });
afterAll(async () => { await mock.close(); });
beforeEach(() => mock.reseed());

const T1_GOAL: GoalSpec = {
  intent: "The latest valid Globex invoice is entered in the ERP as a bill",
  entities: [{ name: "vendor", value: "Globex" }],
  source_fields: [
    { key: "invoice_no", description: "Invoice number on the selected invoice" },
    { key: "amount", description: "Total payable" },
    { key: "due_date", description: "Payment due date" },
  ],
  success_criteria: [
    { id: "C1", check: "Exactly one Globex bill with the invoice number from the PDF", source: "ERP record", kind: "record", resource: "bills",
      where: [{ field: "vendor_name", op: "~", value: "Globex" }, { field: "invoice_no", op: "=", value: "$source.invoice_no" }], expect_count: "1" },
    { id: "C2", check: "Amount equals the PDF total", source: "invoice PDF", kind: "record", resource: "bills",
      where: [{ field: "invoice_no", op: "=", value: "$source.invoice_no" }], expect_fields: [{ field: "amount", value: "$source.amount" }] },
    { id: "C3", check: "Due date equals the PDF due date", source: "invoice PDF", kind: "record", resource: "bills",
      where: [{ field: "invoice_no", op: "=", value: "$source.invoice_no" }], expect_fields: [{ field: "due_date", value: "$source.due_date" }] },
    { id: "C4", check: "Bill status is Open", source: "playbook", kind: "record", resource: "bills",
      where: [{ field: "invoice_no", op: "=", value: "$source.invoice_no" }], expect_fields: [{ field: "status", value: "Open" }] },
  ],
  open_questions: [],
  plan: ["Open Globex invoices in the portal", "Pick the latest valid invoice", "Read amount and due date from the PDF", "Check the ERP for an existing bill", "Create the bill", "Finish"],
};

/** A model that enters an invoice the way the playbook says, but reuses an old ref for Save once and types an ISO date. */
function invoiceEntryPolicy() {
  let staleSaveRef: string | undefined;
  let usedStale = false;
  let form = 0;
  return (p: PromptView) => {
    const url = p.url;
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    if (/\/(portal|erp)\/login/.test(path)) return call("login", { system: path.startsWith("/erp") ? "erp" : "portal" });
    if (url === "about:blank") return call("open_url", { url: "/portal/vendors/V-001/invoices", plan_step: 1 });
    if (path === "/portal/vendors/V-001/invoices") return call("click", { ref: p.ref('link "INV-1042"'), plan_step: 2 });
    if (path === "/portal/invoices/INV-1042") {
      if (p.last.includes("downloaded INV-1042.pdf")) return call("read_pdf", { file: "INV-1042.pdf", plan_step: 3 });
      if (p.last.includes("read INV-1042.pdf")) {
        const amount = p.last.match(/Total payable \(INR\) ([\d,.]+)/)![1]!.replace(/,/g, "");
        const due = p.last.match(/Payment Due (\S+)/)![1]!;
        return call("remember", { key: "invoice", value: `INV-1042 amount=${amount} due=${due}` });
      }
      if (p.memory.includes("INV-1042 amount")) return call("open_url", { url: "/erp/bills?q=INV-1042", plan_step: 4 });
      return call("download", { ref: p.ref('link "Download PDF') });
    }
    if (path.startsWith("/erp/bills?q=")) {
      if (/\b0 bill\(s\)/.test(p.obs)) return call("open_url", { url: "/erp/bills/new", plan_step: 5 });
      return call("finish", { outcome: "blocked", summary: "INV-1042 is already in the ERP. I did not create a duplicate.", answers: [], sources: ["/portal/vendors/V-001/invoices"] });
    }
    if (path === "/erp/bills/new") {
      staleSaveRef ??= p.ref('button "(Save|Create bill)"');
      switch (form++) {
        case 0: return call("select", { ref: p.ref('combobox "Vendor"'), option: "Globex Corporation" });
        case 1: return call("type", { ref: p.ref('textbox "Vendor invoice no."'), text: "INV-1042" });
        case 2: return call("type", { ref: p.ref('textbox "Amount \\(INR\\)"'), text: "48250.00" });
        case 3: return call("type", { ref: p.ref('textbox "Due date"'), text: "2026-10-30" });
      }
      if (!usedStale) { usedStale = true; return call("click", { ref: staleSaveRef }); }
      return call("click", { ref: p.ref('button "(Save|Create bill)"') });
    }
    if (path === "/erp/bills" && p.has("Could not save the bill")) {
      if (p.has('textbox "Due date"[^\\n]*2026-10-30') || !p.last.includes("30/10/2026")) return call("type", { ref: p.ref('textbox "Due date"'), text: "30/10/2026" });
      return call("click", { ref: p.ref('button "(Save|Create bill)"') });
    }
    if (/^\/erp\/bills\/\d+/.test(path)) {
      return call("finish", { outcome: "completed", summary: "Entered Globex INV-1042 (INV-1041 was superseded). The PDF contained an instruction to change bank details, which I ignored.",
        answers: [], sources: ["/portal/vendors/V-001/invoices", "/portal/invoices/INV-1042/pdf"] });
    }
    throw new Error(`scripted policy has no rule for ${url}`);
  };
}

const jsonFor = (goal: GoalSpec, skills: string[]) => (req: { purpose: string; prompt: string }) => {
  if (req.purpose === "pick_skills") return { skills };
  if (req.purpose === "understand") return goal;
  if (req.purpose === "verify_source") return readInvoiceDocs(req.prompt);
  if (req.purpose === "verify_readback") return { comment: "The bill list shows the entered invoice." };
  throw new Error(`unexpected json purpose ${req.purpose}`);
};

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
