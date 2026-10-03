import { describe, expect, it } from "vitest";
import type { Criterion } from "@clerk/shared";
import { countMatches, evaluateRows, matches, normDate, normNumber, sameValue } from "../src/compare.js";

describe("comparators", () => {
  it("normalises dates from every format we meet", () => {
    expect(normDate("2026-10-30")).toBe("2026-10-30");
    expect(normDate("30/10/2026")).toBe("2026-10-30");
    expect(normDate("30-10-2026")).toBe("2026-10-30");
    expect(normDate("3/1/2026")).toBe("2026-01-03");
    expect(normDate("30 Oct 2026")).toBe("2026-10-30");
    expect(normDate("2026-10-30T00:00:00Z")).toBe("2026-10-30");
    expect(normDate("INV-1042")).toBeNull();
  });

  it("normalises amounts with currency signs and Indian grouping", () => {
    expect(normNumber("₹48,250.00")).toBe(48250);
    expect(normNumber("INR 48250")).toBe(48250);
    expect(normNumber("4,82,500.50")).toBe(482500.5);
    expect(normNumber("Rs. 12")).toBe(12);
    expect(normNumber("12a")).toBeNull();
  });

  it("compares by kind: date, decimal, else case-insensitive text", () => {
    expect(sameValue("30/10/2026", "2026-10-30")).toBe(true);
    expect(sameValue("48,250.00", "48250")).toBe(true);
    expect(sameValue("48250.00", "48250.01")).toBe(false);
    expect(sameValue("open", "Open")).toBe(true);
    expect(sameValue(true, "true")).toBe(true);
    expect(sameValue("INV-1042", "INV-1041")).toBe(false);
  });

  it("counts", () => {
    expect(countMatches("1", 1)).toBe(true);
    expect(countMatches("1", 2)).toBe(false);
    expect(countMatches(">=1", 3)).toBe(true);
    expect(countMatches("0", 0)).toBe(true);
    expect(countMatches("> 2", 2)).toBe(false);
    expect(countMatches("many", 2)).toBe(false);
  });

  it("filters rows with =, != and ~ and resolves $source values", () => {
    const row = { vendor_name: "Globex Corporation", invoice_no: "INV-1042", status: "Open", overdue: false };
    expect(matches(row, [{ field: "vendor_name", op: "~", value: "globex" }], {})).toBe(true);
    expect(matches(row, [{ field: "invoice_no", op: "=", value: "$source.invoice_no" }], { invoice_no: "INV-1042" })).toBe(true);
    expect(matches(row, [{ field: "invoice_no", op: "=", value: "$source.invoice_no" }], {})).toBe(false);
    expect(matches(row, [{ field: "status", op: "!=", value: "Paid" }], {})).toBe(true);
    expect(matches(row, [{ field: "overdue", op: "=", value: "false" }], {})).toBe(true);
  });
});

describe("criterion evaluation", () => {
  const bills = [
    { id: 1, vendor_name: "Initech LLC", invoice_no: "IN-5501", amount: "12400.00", status: "Escalated", overdue: true },
    { id: 2, vendor_name: "Initech LLC", invoice_no: "IN-5517", amount: "8750.50", status: "Open", overdue: true },
    { id: 3, vendor_name: "Initech LLC", invoice_no: "IN-5544", amount: "5600.00", status: "Open", overdue: false },
    { id: 4, vendor_name: "Initech LLC", invoice_no: "IN-5490", amount: "9999.00", status: "Paid", overdue: false },
  ];
  const initech = { field: "vendor_name", op: "~" as const, value: "initech" };

  it("record: every matching row must have the expected field value", () => {
    const c: Criterion = { id: "C1", check: "overdue escalated", source: "ERP", kind: "record", resource: "bills",
      where: [initech, { field: "overdue", op: "=", value: "true" }], expect_fields: [{ field: "status", value: "Escalated" }] };
    const out = evaluateRows(c, bills, {});
    expect(out.pass).toBe(false);
    expect(out.note).toMatch(/1 of 2/);
  });

  it("record: no matching rows fails a field expectation instead of passing vacuously", () => {
    const c: Criterion = { id: "C1", check: "x", source: "ERP", kind: "record", where: [{ field: "invoice_no", op: "=", value: "NOPE" }], expect_fields: [{ field: "status", value: "Open" }] };
    expect(evaluateRows(c, bills, {}).pass).toBe(false);
  });

  it("answer: the agent's reported total must equal the sum computed in code", () => {
    const c: Criterion = { id: "C2", check: "total outstanding", source: "ERP", kind: "answer", resource: "bills",
      where: [initech, { field: "status", op: "!=", value: "Paid" }], answer_key: "total_outstanding", aggregate: "sum_amount" };
    const finish = (value: string) => ({ outcome: "completed" as const, summary: "", sources: [], answers: [{ key: "total_outstanding", value }] });
    expect(evaluateRows(c, bills, {}, finish("₹26,750.50")).pass).toBe(true);
    expect(evaluateRows(c, bills, {}, finish("26750")).pass).toBe(false);
    expect(evaluateRows(c, bills, {}, undefined).found).toBe("(no answer reported)");
    // keys written by different model calls still line up
    const two = { outcome: "completed" as const, summary: "", sources: [], answers: [{ key: "total_owed", value: "26750.50" }, { key: "count", value: "3" }] };
    expect(evaluateRows({ ...c, answer_key: "total_owed_initech" }, bills, {}, two).pass).toBe(true);
  });

  it("missing source value fails with a reason", () => {
    const c: Criterion = { id: "C1", check: "x", source: "PDF", kind: "record", where: [{ field: "invoice_no", op: "=", value: "$source.invoice_no" }], expect_count: "1" };
    const out = evaluateRows(c, bills, {});
    expect(out.pass).toBe(false);
    expect(out.note).toMatch(/did not produce invoice_no/);
  });
});
