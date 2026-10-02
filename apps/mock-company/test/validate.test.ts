import { describe, expect, it } from "vitest";
import { validateBill } from "../src/erp/validate.js";
import { formatInr, parseAmount, parseDueDate } from "../src/dates.js";

const base = { vendor_id: "V-001", invoice_no: "INV-1042", amount: "48,250.00", due_date: "30/10/2026", notes: "" };
const opts = { strictDates: true, vendorIds: ["V-001"] };

describe("bill validation", () => {
  it("accepts a well-formed bill and normalises values", () => {
    expect(validateBill(base, opts)).toEqual({ ok: true, bill: { ...base, amount: "48250.00", due_date: "2026-10-30" } });
  });
  it("rejects ISO dates when strict (the chaos trap) but accepts them otherwise", () => {
    const iso = { ...base, due_date: "2026-10-30" };
    expect(validateBill(iso, opts)).toEqual({ ok: false, errors: ["Invalid date format. Enter due date as DD/MM/YYYY."] });
    expect(validateBill(iso, { ...opts, strictDates: false }).ok).toBe(true);
  });
  it("rejects impossible dates, bad amounts and unknown vendors", () => {
    const r = validateBill({ ...base, vendor_id: "V-999", amount: "48.250,00", due_date: "31/02/2026" }, opts);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors).toHaveLength(3);
  });
});

describe("amount and date helpers", () => {
  it.each([["48250", "48250.00"], ["₹48,250.00", "48250.00"], ["INR 1,23,456.5", "123456.50"]])("parses %s", (input, out) => {
    expect(parseAmount(input)).toEqual({ amount: out });
  });
  it("formats with Indian digit grouping", () => {
    expect(formatInr("123456.50")).toBe("₹1,23,456.50");
    expect(formatInr("48250.00")).toBe("₹48,250.00");
  });
  it("parses DD/MM/YYYY", () => expect(parseDueDate("30/10/2026", { acceptIso: false })).toEqual({ iso: "2026-10-30" }));
});
