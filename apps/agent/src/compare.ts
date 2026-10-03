// Deterministic comparison for verification. Values from documents, the ERP and the agent come in
// different shapes ("₹48,250.00" vs "48250.00", "30/10/2026" vs "2026-10-30"); normalise, then compare.
// No model is involved in any pass/fail decision made here.
import type { Criterion, FinishArgs, Where } from "@clerk/shared";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Parse a date in the formats we meet (ISO, DD/MM/YYYY, DD-MM-YYYY, "30 Oct 2026") to ISO, or null. */
export function normDate(v: string): string | null {
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})$/);
  if (m) {
    const mo = MONTHS.indexOf(m[2]!.toLowerCase());
    if (mo >= 0) return `${m[3]}-${String(mo + 1).padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  }
  return null;
}

/** Parse an amount or count ("₹48,250.00", "INR 48250", "3") to a number, or null. */
export function normNumber(v: string): number | null {
  const s = v.trim().replace(/^(₹|INR|Rs\.?)\s*/i, "").replace(/,/g, "");
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

export function sameValue(a: unknown, b: unknown): boolean {
  const x = String(a ?? "").trim();
  const y = String(b ?? "").trim();
  const dx = normDate(x), dy = normDate(y);
  if (dx && dy) return dx === dy;
  const nx = normNumber(x), ny = normNumber(y);
  if (nx !== null && ny !== null) return Math.abs(nx - ny) < 0.005;
  return x.toLowerCase() === y.toLowerCase();
}

export type Row = Record<string, unknown>;

export type Resolved = { ok: true; value: string } | { ok: false; missing: string };

/** "$source.amount" -> the value the verifier re-read from the source document. */
export function resolve(value: string, source: Record<string, string>): Resolved {
  const m = value.match(/^\$source\.(\w+)$/);
  if (!m) return { ok: true, value };
  const v = source[m[1]!];
  return v === undefined || v === "" ? { ok: false, missing: m[1]! } : { ok: true, value: v };
}

export function matches(row: Row, where: Where[], source: Record<string, string>): boolean {
  return where.every((w) => {
    const r = resolve(w.value, source);
    if (!r.ok) return false;
    const cell = row[w.field];
    if (w.op === "~") return String(cell ?? "").toLowerCase().includes(r.value.toLowerCase());
    return w.op === "=" ? sameValue(cell, r.value) : !sameValue(cell, r.value);
  });
}

export function countMatches(expect: string, n: number): boolean {
  const m = expect.trim().match(/^(>=|<=|>|<|=)?\s*(\d+)$/);
  if (!m) return false;
  const k = Number(m[2]);
  switch (m[1]) {
    case ">=": return n >= k;
    case "<=": return n <= k;
    case ">": return n > k;
    case "<": return n < k;
    default: return n === k;
  }
}

export type CheckOutcome = { expected: string; found: string; pass: boolean; note?: string };

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** Evaluate a record or answer criterion against ERP rows. */
export function evaluateRows(c: Criterion, rows: Row[], source: Record<string, string>, finish?: FinishArgs): CheckOutcome {
  const where = c.where ?? [];
  const missing = where.map((w) => resolve(w.value, source)).find((r) => !r.ok);
  if (missing && !missing.ok) return { expected: `$source.${missing.missing}`, found: "-", pass: false, note: `source re-check did not produce ${missing.missing}` };
  const hits = rows.filter((r) => matches(r, where, source));
  const ids = hits.map((r) => r.id).filter((x) => x !== undefined).slice(0, 6).join(", ");

  if (c.kind === "answer") {
    const answers = finish?.answers ?? [];
    // Keys are written by two model calls (planner, agent), so match tolerantly: exact, then one
    // contains the other ("total_owed" vs "total_owed_initech"), then the only answer given.
    const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");
    const want = norm(c.answer_key ?? "");
    const given = answers.find((a) => norm(a.key) === want)
      ?? (want ? answers.find((a) => norm(a.key).includes(want) || want.includes(norm(a.key))) : undefined)
      ?? (answers.length === 1 ? answers[0] : undefined);
    const truth = c.aggregate === "count" ? hits.length : hits.reduce((s, r) => s + (normNumber(String(r.amount ?? "0")) ?? 0), 0);
    if (!given) return { expected: fmt(truth), found: "(no answer reported)", pass: false };
    return { expected: fmt(truth), found: given.value, pass: sameValue(given.value, fmt(truth)), note: `${c.aggregate ?? "sum_amount"} over ${hits.length} row(s)` };
  }

  const parts: CheckOutcome[] = [];
  if (c.expect_count) parts.push({ expected: `count ${c.expect_count}`, found: `${hits.length}${ids ? ` (#${ids})` : ""}`, pass: countMatches(c.expect_count, hits.length) });
  for (const f of c.expect_fields ?? []) {
    const r = resolve(f.value, source);
    if (!r.ok) { parts.push({ expected: `$source.${r.missing}`, found: "-", pass: false, note: `source re-check did not produce ${r.missing}` }); continue; }
    if (!hits.length) { parts.push({ expected: `${f.field} = ${r.value}`, found: "no matching rows", pass: false }); continue; }
    const wrong = hits.filter((h) => !sameValue(h[f.field], r.value));
    const found = [...new Set(hits.map((h) => String(h[f.field])))].join(", ");
    parts.push({ expected: `${f.field} = ${r.value}`, found: `${f.field} = ${found}`, pass: wrong.length === 0, note: wrong.length ? `${wrong.length} of ${hits.length} row(s) differ` : undefined });
  }
  if (!parts.length) return { expected: "at least 1 row", found: String(hits.length), pass: hits.length > 0 };
  return {
    expected: parts.map((p) => p.expected).join("; "),
    found: parts.map((p) => p.found).join("; "),
    pass: parts.every((p) => p.pass),
    note: parts.map((p) => p.note).filter(Boolean).join("; ") || undefined,
  };
}
