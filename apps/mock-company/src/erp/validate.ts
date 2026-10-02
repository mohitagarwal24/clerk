import { parseAmount, parseDueDate } from "../dates.js";

export type BillInput = { vendor_id: string; invoice_no: string; amount: string; due_date: string; notes: string };
export type ValidBill = { vendor_id: string; invoice_no: string; amount: string; due_date: string; notes: string };

/** Server-side validation for the new-bill form. Returns field errors in the order shown on the page. */
export function validateBill(input: BillInput, opts: { strictDates: boolean; vendorIds: string[] }):
  { ok: true; bill: ValidBill } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!opts.vendorIds.includes(input.vendor_id)) errors.push("Select a vendor.");
  const invoiceNo = input.invoice_no.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9/-]{2,24}$/.test(invoiceNo)) errors.push("Invoice number is required (letters, digits, - or /).");
  const amount = parseAmount(input.amount);
  if ("error" in amount) errors.push(amount.error);
  const due = parseDueDate(input.due_date, { acceptIso: !opts.strictDates });
  if ("error" in due) errors.push(due.error);
  if (errors.length || "error" in amount || "error" in due) return { ok: false, errors };
  return { ok: true, bill: { vendor_id: input.vendor_id, invoice_no: invoiceNo, amount: amount.amount, due_date: due.iso, notes: input.notes.trim().slice(0, 500) } };
}

export const BILL_STATUSES = ["Open", "Escalated", "Paid"] as const;
