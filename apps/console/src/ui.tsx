import type { ReactNode } from "react";
import type { RunStatus } from "@clerk/shared";

export const Icon = {
  plus: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>,
  runs: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 6h16M4 12h10M4 18h7" /></svg>,
  shield: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4" /><path d="M12 3l7 3v6c0 4-3 7.5-7 9-4-1.5-7-5-7-9V6z" /></svg>,
  evals: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>,
  book: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3z" /><path d="M5 17a3 3 0 013-3h11" /></svg>,
  bolt: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L4 14h7l-1 8 9-12h-7z" /></svg>,
  lock: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></svg>,
  arrow: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>,
  check: (color = "#1F7A4D", size = 18) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none", marginTop: 1 }}><path d="M5 12l5 5 9-10" /></svg>,
  cross: (color: string, size = 38) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>,
  pause: (color: string, size = 38) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round"><path d="M9 5v14M15 5v14" /></svg>,
  play: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 4l14 8-14 8z" /></svg>,
};

export type Tone = "ok" | "wait" | "stop" | "agent" | "neutral";

export function statusTone(status: RunStatus): Tone {
  switch (status) {
    case "DONE": return "ok";
    case "AWAITING_APPROVAL": case "AWAITING_USER": return "wait";
    case "NEEDS_ATTENTION": case "FAILED": return "stop";
    default: return "agent";
  }
}

export function statusLabel(s: { status: RunStatus; verified?: string; stopReason?: string }): string {
  switch (s.status) {
    case "DONE": return `VERIFIED${s.verified ? ` ${s.verified}` : ""}`;
    case "AWAITING_APPROVAL": return "NEEDS APPROVAL";
    case "AWAITING_USER": return "WAITING ON YOU";
    case "NEEDS_ATTENTION": return `STOPPED${s.stopReason ? ` · ${shortReason(s.stopReason)}` : ""}`;
    case "FAILED": return "FAILED";
    case "VERIFYING": return "VERIFYING";
    case "UNDERSTANDING": return "UNDERSTANDING";
    default: return "RUNNING";
  }
}

function shortReason(r: string): string {
  const s = r.toLowerCase();
  if (s.includes("duplicate") || s.includes("already")) return "DUPLICATE";
  if (s.includes("bank") || s.includes("policy") || s.includes("verif")) return "POLICY";
  if (s.includes("loop") || s.includes("no progress")) return "LOOP";
  if (s.includes("budget")) return "BUDGET";
  if (s.includes("stopped by")) return "BY USER";
  return "NEEDS YOU";
}

export const Chip = ({ tone, children }: { tone: Tone; children: ReactNode }) => <span className={`chip ${tone}`}>{children}</span>;

export const TAG_TONE: Record<string, Tone> = { ACT: "agent", RECOVER: "wait", ADAPT: "wait", ASK: "wait", DECIDE: "neutral", PLAN: "neutral", VERIFY: "ok" };

export const inr = (v: string | number) => {
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : String(v);
};
export const go = (path: string) => { location.hash = path; };
