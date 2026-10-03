import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { ApprovalRequest, RunStatus } from "@clerk/shared";

export const go = (path: string) => { location.hash = path; };

// ---- Technical-details layer ----------------------------------------------
// The default view is for the person who asked for the work. Engineers flip this on to see
// tool calls, refs, tags, tokens, run IDs and how each check was verified.

const TechContext = createContext<{ tech: boolean; setTech: (v: boolean) => void }>({ tech: false, setTech: () => {} });

export function TechProvider({ children }: { children: ReactNode }) {
  const [tech, setTechState] = useState(() => { try { return localStorage.getItem("clerk.tech") === "1"; } catch { return false; } });
  const setTech = (v: boolean) => { setTechState(v); try { localStorage.setItem("clerk.tech", v ? "1" : "0"); } catch { /* private mode */ } };
  return <TechContext.Provider value={{ tech, setTech }}>{children}</TechContext.Provider>;
}
export const useTech = () => useContext(TechContext);

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="switch" onClick={() => onChange(!on)}>
      <span className="track" />{label}
    </button>
  );
}

// ---- Status in plain words ------------------------------------------------

export type Tone = "ok" | "wait" | "stop" | "agent";

export function statusTone(status: RunStatus): Tone {
  if (status === "DONE") return "ok";
  if (status === "AWAITING_APPROVAL" || status === "AWAITING_USER") return "wait";
  if (status === "NEEDS_ATTENTION" || status === "FAILED") return "stop";
  return "agent";
}

export function statusText(status: RunStatus): string {
  switch (status) {
    case "UNDERSTANDING": return "Reading your request";
    case "EXECUTING": case "RECOVERING": return "Working";
    case "AWAITING_APPROVAL": return "Waiting for your approval";
    case "AWAITING_USER": return "Waiting for your answer";
    case "VERIFYING": return "Double-checking the result";
    case "DONE": return "Done · verified";
    case "NEEDS_ATTENTION": return "Stopped · needs you";
    case "FAILED": return "Couldn't finish";
  }
}

export const StatusBadge = ({ status }: { status: RunStatus }) => {
  const tone = statusTone(status);
  return <span className={`badge ${tone}`}><span className={`dot ${tone === "agent" ? "pulse" : ""}`} style={{ background: "currentColor" }} />{statusText(status)}</span>;
};

// ---- Words for ERP fields and writes --------------------------------------

const FIELD_LABELS: Record<string, string> = {
  vendor_id: "Vendor", invoice_no: "Invoice no.", amount: "Amount", due_date: "Due date", notes: "Notes", status: "Status",
  contact_email: "Contact e-mail", bank_account: "Bank account", bank_ifsc: "IFSC",
};
export const fieldLabel = (name: string) => FIELD_LABELS[name] ?? humanize(name);
/** Criteria text sometimes contains "$source.amount"; say "the amount on the source document". */
export const plainCheck = (text: string) =>
  text.replace(/\$source\.(\w+)/g, (_, k: string, at: number) => {
    const words = k.toLowerCase().split("_").filter((w) => w.length > 2);
    const before = text.slice(Math.max(0, at - 30), at).toLowerCase();
    // "amount $source.amount" -> "amount as on the source document"; otherwise name the field.
    return words.some((w) => before.includes(w)) ? "as on the source document" : `the ${k.replace(/_/g, " ").replace(/\bno\b/, "number")} on the source document`;
  });

export const humanize = (key: string) => { const s = key.replace(/^\$?source\./i, "").replace(/[_.-]+/g, " ").trim(); return s.charAt(0).toUpperCase() + s.slice(1); };

export function approvalTitle(req: Pick<ApprovalRequest, "path" | "fields">, vendorName?: (id: string) => string | undefined): string {
  const p = req.path;
  if (/^\/erp\/bills$/.test(p)) return "Create this bill in the ERP?";
  const status = req.fields.find((f) => f.name === "status")?.value;
  const bill = p.match(/^\/erp\/bills\/(\d+)\/status$/);
  if (bill) return `Change bill #${bill[1]} to ${status ?? "a new status"}?`;
  const vendor = p.match(/^\/erp\/vendors\/([^/]+)$/);
  if (vendor) return `Update the vendor record for ${vendorName?.(vendor[1]!) ?? vendor[1]}?`;
  return "Send this change to the ERP?";
}

/** Labels of the fields that differ from the last approved request to the same place. */
export function changedLabels(req: Pick<ApprovalRequest, "fields" | "previous">): string[] {
  if (!req.previous) return [];
  const before = new Map(req.previous.map((f) => [f.name, f.value]));
  return req.fields.filter((f) => before.get(f.name) !== f.value).map((f) => fieldLabel(f.name));
}

/** Short past-tense label for a decided write, for feeds and reports. */
export function approvalDone(req: Pick<ApprovalRequest, "path" | "fields">): string {
  const p = req.path;
  if (/^\/erp\/bills$/.test(p)) return `creating bill ${req.fields.find((f) => f.name === "invoice_no")?.value ?? ""}`.trim();
  const bill = p.match(/^\/erp\/bills\/(\d+)\/status$/);
  if (bill) return `setting bill #${bill[1]} to ${req.fields.find((f) => f.name === "status")?.value ?? "a new status"}`;
  if (/^\/erp\/vendors\//.test(p)) return "the vendor record change";
  return `${p}`;
}

export const inr = (v: string | number) => {
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : String(v);
};

export const ago = (iso?: string) => {
  if (!iso) return "";
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
};

export const duration = (from?: string, to?: string | number) => {
  if (!from) return "";
  const s = Math.max(0, Math.round(((typeof to === "number" ? to : to ? Date.parse(to) : Date.now()) - Date.parse(from)) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
};

export const Icon = {
  check: (color = "#fff", size = 12) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-10" /></svg>,
  cross: (color = "#fff", size = 12) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>,
  pause: (color: string, size = 30) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round"><path d="M9 5v14M15 5v14" /></svg>,
  lock: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></svg>,
  shield: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4" /><path d="M12 3l7 3v6c0 4-3 7.5-7 9-4-1.5-7-5-7-9V6z" /></svg>,
  ask: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 015 .5c0 1.5-2.5 2-2.5 3.5M12 17h.01" /></svg>,
  arrow: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>,
  doc: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z" /><path d="M14 3v6h6" /></svg>,
};
