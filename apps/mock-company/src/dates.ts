// The ERP stores ISO dates and shows DD/MM/YYYY, like most Indian back-office tools.

export function isoToDmy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function addDays(iso: string, days: number): string {
  const t = new Date(`${iso}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

export function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function validCalendarDate(y: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Parse a user-entered due date. Returns ISO or an error message shown on the form. */
export function parseDueDate(input: string, opts: { acceptIso: boolean }): { iso: string } | { error: string } {
  const s = input.trim();
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (!validCalendarDate(y, mo, d)) return { error: `Due date ${s} is not a real calendar date.` };
    return { iso: `${m[3]}-${m[2]}-${m[1]}` };
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m && opts.acceptIso) {
    if (!validCalendarDate(Number(m[1]), Number(m[2]), Number(m[3]))) return { error: `Due date ${s} is not a real calendar date.` };
    return { iso: s };
  }
  return { error: "Invalid date format. Enter due date as DD/MM/YYYY." };
}

/** Amounts: digits with optional commas and up to 2 decimals. Returns a normalised "12345.60" string. */
export function parseAmount(input: string): { amount: string } | { error: string } {
  const s = input.trim().replace(/^₹\s*/, "").replace(/^INR\s*/i, "");
  if (!/^\d{1,3}(,\d{2,3})*(\.\d{1,2})?$|^\d+(\.\d{1,2})?$/.test(s)) {
    return { error: "Amount must be a number with at most 2 decimal places." };
  }
  const n = Number(s.replace(/,/g, ""));
  if (!(n > 0)) return { error: "Amount must be greater than zero." };
  return { amount: n.toFixed(2) };
}

export function formatInr(amount: string): string {
  const [whole, frac = "00"] = amount.split(".");
  const w = whole ?? "0";
  // Indian grouping: last 3 digits, then pairs
  const last3 = w.slice(-3);
  const rest = w.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `₹${rest ? `${rest},${last3}` : last3}.${frac.padEnd(2, "0")}`;
}
