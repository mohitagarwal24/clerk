// Shared scripted-model fixtures: the T1 goal and an invoice-entry policy that walks into every trap.
import type { GoalSpec } from "@clerk/shared";
import { call, type PromptView, readInvoiceDocs } from "./scripted-llm.js";

export const T1_GOAL: GoalSpec = {
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
export function invoiceEntryPolicy() {
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
        const docs = p.section("Documents you have read");
        const amount = docs.match(/Total payable \(INR\) ([\d,.]+)/)![1]!.replace(/,/g, "");
        const due = docs.match(/Payment Due (\S+)/)![1]!;
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

export const jsonFor = (goal: GoalSpec, skills: string[]) => (req: { purpose: string; prompt: string }) => {
  if (req.purpose === "pick_skills") return { skills };
  if (req.purpose === "understand") return goal;
  if (req.purpose === "verify_source") return readInvoiceDocs(req.prompt);
  if (req.purpose === "verify_readback") return { comment: "The bill list shows the entered invoice." };
  throw new Error(`unexpected json purpose ${req.purpose}`);
};

