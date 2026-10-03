// API client and the event reducer. The console never polls run state: it folds the same
// RunEvent stream the CLI prints into a view model.
import { useEffect, useReducer, useState } from "react";
import type {
  ActionRecord, ApprovalDecision, ApprovalRequest, ChaosPreset, EvalCase, EvalResult, GoalSpec, Question, Recovery,
  RunEvent, RunState, RunStatus, RunSummary, Usage, Verification,
} from "@clerk/shared";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const startRun = (request: string, chaos: ChaosPreset) => api<{ id: string }>("/runs", { method: "POST", body: JSON.stringify({ request, chaos }) });
export const approve = (runId: string, id: string, d: ApprovalDecision) => api(`/runs/${runId}/approve`, { method: "POST", body: JSON.stringify({ id, ...d }) });
export const answer = (runId: string, id: string, text: string) => api(`/runs/${runId}/answer`, { method: "POST", body: JSON.stringify({ id, answer: text }) });
export const stopRun = (runId: string) => api(`/runs/${runId}/stop`, { method: "POST" });
export const fileUrl = (runId: string, rel: string) => `/api/runs/${runId}/files/${rel}`;

export type Health = { portal: boolean; erp: boolean; model: string | null; modelReady: boolean; tracing: boolean; phoenixUrl: string | null };
export type PlaybookEntry = { name: string; description: string; rule: string; appliesTo: string[] };
export type RunDetail = { state: RunState; pendingApprovals: ApprovalRequest[]; pendingQuestions: Question[]; traceUrl: string | null; screenshots: string[] };
export type EvalsData = { cases: EvalCase[]; results: { ranAt: string; model: string; results: EvalResult[] } | null };

export function useFetch<T>(path: string | null, deps: unknown[] = []): { data: T | null; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    let live = true;
    api<T>(path).then((d) => live && setData(d)).catch((e) => live && setError(String(e)));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  return { data, error };
}

// ---- Live run view model --------------------------------------------------

export type RunView = {
  id: string;
  request: string;
  chaos: ChaosPreset;
  status: RunStatus;
  statusNote?: string;
  maxSteps: number;
  step: number;
  startedAt?: string;
  endedAt?: string;
  goal?: GoalSpec;
  revision: number;
  planDone: number;
  skills: string[];
  actions: ActionRecord[];
  recoveries: Recovery[];
  observations: number;
  lastShot?: { url: string; title: string; screenshot?: string; step: number };
  approvals: ApprovalRequest[];
  resolved: Record<string, ApprovalDecision>;
  questions: Question[];
  answers: Record<string, string>;
  facts: Record<string, string>;
  usage: Usage;
  injections: { step: number; where: string; text: string }[];
  verification?: Verification;
  finished?: { status: RunStatus; summary: string; stopReason?: string };
  error?: string;
};

export const emptyView = (id: string): RunView => ({
  id, request: "", chaos: "off", status: "UNDERSTANDING", maxSteps: 40, step: 0, revision: 0, planDone: 0, skills: [],
  actions: [], recoveries: [], observations: 0, approvals: [], resolved: {}, questions: [], answers: {}, facts: {},
  usage: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }, injections: [],
});

export function reduce(v: RunView, e: RunEvent): RunView {
  switch (e.type) {
    case "run_started": return { ...v, request: e.request, chaos: e.chaos, maxSteps: e.maxSteps, startedAt: e.at };
    case "status": return { ...v, status: e.status, statusNote: e.note };
    case "goal": return { ...v, goal: e.goal, revision: e.revision, skills: e.skills, planDone: e.revision > v.revision && v.revision > 0 ? 0 : v.planDone };
    case "skill_loaded": return v.skills.includes(e.name) ? v : { ...v, skills: [...v.skills, e.name] };
    case "action": return { ...v, actions: [...v.actions, e.action], step: Math.max(v.step, e.action.step) };
    case "observation": return { ...v, observations: v.observations + 1, lastShot: { url: e.url, title: e.title, screenshot: e.screenshot, step: e.step } };
    case "memory": return { ...v, facts: e.facts };
    case "plan_progress": return { ...v, planDone: e.done };
    case "recovery": return { ...v, recoveries: [...v.recoveries, e.recovery] };
    case "approval_requested": return { ...v, approvals: [...v.approvals, e.request] };
    case "approval_resolved": return { ...v, resolved: { ...v.resolved, [e.id]: e.decision } };
    case "question": return { ...v, questions: [...v.questions, e.question] };
    case "answered": return { ...v, answers: { ...v.answers, [e.id]: e.answer } };
    case "injection_flag": return { ...v, injections: [...v.injections, { step: e.step, where: e.where, text: e.text }] };
    case "usage": return { ...v, usage: e.usage };
    case "verification": return { ...v, verification: e.verification };
    case "finished": return { ...v, status: e.status, finished: { status: e.status, summary: e.summary, stopReason: e.stopReason }, endedAt: e.at };
    case "error": return { ...v, error: e.message };
  }
}

/** Subscribe to a run's events (SSE replays history first, so a reload rebuilds the same view). */
export function useRun(id: string): RunView {
  const [view, dispatch] = useReducer((s: RunView, e: RunEvent | { type: "reset"; id: string }) => (e.type === "reset" ? emptyView(e.id) : reduce(s, e)), emptyView(id));
  useEffect(() => {
    dispatch({ type: "reset", id });
    const es = new EventSource(`/api/runs/${id}/events`);
    let last = 0;
    es.addEventListener("run", (m) => {
      const e = JSON.parse((m as MessageEvent).data) as RunEvent;
      if (e.seq <= last) return;
      last = e.seq;
      dispatch(e);
      if (e.type === "finished") es.close();
    });
    return () => es.close();
  }, [id]);
  return view;
}

export function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export const elapsed = (from?: string, to?: string | number) => {
  if (!from) return "00:00";
  const s = Math.max(0, Math.round(((typeof to === "number" ? to : to ? Date.parse(to) : Date.now()) - Date.parse(from)) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export type { RunSummary };

/** Vendor id -> "Name (City)", from the agent API's server-side ERP read. */
export function useVendorName(): (id: string) => string | undefined {
  const { data } = useFetch<{ id: string; name: string; city: string }[]>("/lookup/vendors");
  return (id: string) => {
    const v = data?.find((x) => x.id === id);
    return v ? `${v.name} (${v.city})` : undefined;
  };
}
