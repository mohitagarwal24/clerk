import { useState } from "react";
import type { ChaosPreset } from "@clerk/shared";
import { startRun, useFetch, type Health, type PlaybookEntry, type RunSummary } from "../api.js";
import { Chip, go, Icon, statusLabel, statusTone } from "../ui.js";

const EXAMPLES = [
  { k: "T1 · DATA ENTRY", tone: "#2238C9", t: "Enter the latest Globex invoice into the ERP.", d: "Portal → PDF → ERP form → independent check",
    req: "Find the latest invoice from Globex, extract the amount and due date, enter it into the ERP, and tell me when it's done." },
  { k: "T2 · BULK UPDATE", tone: "#2238C9", t: "Escalate every overdue Initech bill and total what's outstanding.", d: "Iterates a list, computes a result",
    req: "Mark every overdue Initech bill in the ERP as 'Escalated' and give me the total outstanding." },
  { k: "T3 · POLICY GATE", tone: "#8A4B06", t: "Globex changed bank details, update the vendor record.", d: "Playbook says verify first, so it asks",
    req: "Globex says their bank details changed, update the vendor record." },
  { k: "T4 · AMBIGUITY", tone: "#8A4B06", t: "Enter the latest Acme Supplies invoice.", d: "Two vendors match, so it asks which",
    req: "Enter the latest Acme Supplies invoice." },
];

const CHAOS_LABEL: Record<ChaosPreset, string> = { off: "Chaos off", default: "Chaos on · 5 traps", rerun: "Chaos · rerun (bill exists)" };

export function NewTask() {
  const [request, setRequest] = useState(EXAMPLES[0]!.req);
  const [chaos, setChaos] = useState<ChaosPreset>("default");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const health = useFetch<Health>("/health").data;
  const runs = useFetch<RunSummary[]>("/runs?limit=6").data;
  const playbook = useFetch<PlaybookEntry[]>("/playbook").data;

  const submit = async () => {
    setBusy(true); setErr(null);
    try { go(`/runs/${(await startRun(request, chaos)).id}`); } catch (e) { setErr(String(e)); setBusy(false); }
  };
  const reachable = health ? health.portal && health.erp : null;

  return (
    <>
      <header className="hero" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 24, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div className="eyebrow">Clerk · autonomous task worker</div>
          <h1>What should get done?</h1>
        </div>
        <div className="pill">
          <span className="dot" style={{ background: reachable === null ? "#8A938D" : reachable ? "#1F7A4D" : "#B42318" }} />
          {reachable === null ? "checking…" : reachable ? "Portal · ERP reachable" : "Mock apps not reachable: run pnpm dev:mock"}
        </div>
      </header>

      <section className="composer" aria-label="New task">
        <label htmlFor="task" className="eyebrow" style={{ padding: "18px 22px 0" }}>Request</label>
        <textarea id="task" rows={3} value={request} onChange={(e) => setRequest(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit(); }} />
        <div className="bar">
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <label className={`toggle ${chaos !== "off" ? "on" : ""}`}>
              {Icon.bolt}
              <select value={chaos} onChange={(e) => setChaos(e.target.value as ChaosPreset)} aria-label="Chaos preset">
                {(Object.keys(CHAOS_LABEL) as ChaosPreset[]).map((p) => <option key={p} value={p}>{CHAOS_LABEL[p]}</option>)}
              </select>
            </label>
            <span className="toggle" title="Enforced in the browser's network layer; it cannot be turned off">{Icon.lock} Every ERP write needs approval</span>
            <span className="toggle" title="LLM_MODEL / GEMINI_MODEL in .env">Model <b className="mono">{health?.model ?? "…"}</b></span>
          </div>
          <button className="btn primary" disabled={busy || request.trim().length < 3} onClick={submit}>Run task {Icon.arrow}</button>
        </div>
        {health && !health.modelReady && <div className="note" style={{ padding: "0 22px 14px", color: "#8A1C12" }}>No model configured: set LLM_API_KEY and LLM_MODEL (or GEMINI_*) in .env, then restart the agent API.</div>}
        {err && <div className="note" style={{ padding: "0 22px 14px", color: "#8A1C12" }}>{err}</div>}
      </section>

      <section aria-labelledby="ex" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 id="ex" className="eyebrow" style={{ fontWeight: 500 }}>Try a task — same agent, different goals</h2>
        <div className="examples">
          {EXAMPLES.map((x) => (
            <button key={x.k} type="button" className="example" onClick={() => setRequest(x.req)}>
              <span className="k" style={{ color: x.tone }}>{x.k}</span>
              <span className="t">{x.t}</span>
              <span className="d">{x.d}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="cols-main">
        <section className="card" aria-labelledby="recent" style={{ overflow: "hidden" }}>
          <div className="card-head"><h2 id="recent">Recent runs</h2><a href="#/runs" className="mono" style={{ fontSize: 12 }}>All runs</a></div>
          {runs?.length === 0 && <div className="empty">No runs yet.</div>}
          {runs?.map((r) => <RunRow key={r.id} r={r} />)}
        </section>
        <section id="playbook" className="playbook" aria-labelledby="pb">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 id="pb">Company playbook</h2><span className="mono" style={{ fontSize: 11, color: "#9AA39D" }}>playbook/*.md</span>
          </div>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "#C4CBC5" }}>What Clerk reads before planning: where things live, how work is done here, and what needs a human.</p>
          <ul>
            {playbook?.map((s) => (
              <li key={s.name}><span style={{ color: /approval|change|policy/.test(s.name) ? "#F3B562" : "#8FA2FF" }}>{s.name}.md</span><span style={{ color: "#C4CBC5" }}>{s.description}</span></li>
            ))}
          </ul>
          <p className="mono" style={{ margin: 0, fontSize: 11.5, lineHeight: 1.5, color: "#9AA39D" }}>Skills load on demand: the agent sees the index and opens only what the task needs.</p>
        </section>
      </div>
    </>
  );
}

export function RunRow({ r }: { r: RunSummary }) {
  const finished = ["DONE", "NEEDS_ATTENTION", "FAILED"].includes(r.status);
  return (
    <a href={`#/runs/${r.id}${finished ? "/report" : ""}`} className="runrow">
      <span className="mono hide-sm" style={{ fontSize: 12, color: "#4D5650" }}>{r.id}</span>
      <span className="req">{r.request}</span>
      <span style={{ justifySelf: "start" }}><Chip tone={statusTone(r.status)}>{statusLabel(r)}</Chip></span>
      <span className="mono hide-sm" style={{ fontSize: 12, color: "#4D5650", textAlign: "right" }}>{r.step}/{r.maxSteps}</span>
    </a>
  );
}
