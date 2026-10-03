import { useState } from "react";
import type { ChaosPreset } from "@clerk/shared";
import { startRun, useFetch, type Health, type PlaybookEntry, type RunSummary } from "../api.js";
import { ago, go, Icon, StatusBadge, Switch, useTech } from "../ui.js";

const EXAMPLES = [
  { label: "Enter the latest Globex invoice", req: "Find the latest invoice from Globex, extract the amount and due date, enter it into the ERP, and tell me when it's done." },
  { label: "Escalate overdue Initech bills", req: "Mark every overdue Initech bill in the ERP as 'Escalated' and give me the total outstanding." },
  { label: "Update Globex bank details", req: "Globex says their bank details changed, update the vendor record." },
  { label: "Enter the latest Acme Supplies invoice", req: "Enter the latest Acme Supplies invoice." },
];

export function NewTask() {
  const { tech } = useTech();
  const [request, setRequest] = useState(EXAMPLES[0]!.req);
  const [chaos, setChaos] = useState<ChaosPreset>("default");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const health = useFetch<Health>("/health").data;
  const runs = useFetch<RunSummary[]>("/runs?limit=6").data;
  const rules = useFetch<PlaybookEntry[]>("/playbook").data;

  const submit = async () => {
    setBusy(true); setErr(null);
    try { go(`/runs/${(await startRun(request.trim(), chaos)).id}`); } catch (e) { setErr(String(e)); setBusy(false); }
  };

  return (
    <>
      <header className="hero">
        <h1>What should Clerk do?</h1>
        <p>Describe a back-office task in plain words. Clerk works through the Vendor Portal and the ERP like a colleague would, and checks its own work before saying it's done.</p>
      </header>

      <section className="composer" aria-label="New task">
        <textarea aria-label="Task" rows={3} value={request} placeholder="e.g. Enter the latest Globex invoice into the ERP"
          onChange={(e) => setRequest(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit(); }} />
        <div className="chips" aria-label="Examples">
          {EXAMPLES.map((x) => <button key={x.label} type="button" className={`chip ${request === x.req ? "on" : ""}`} onClick={() => setRequest(x.req)}>{x.label}</button>)}
        </div>
        <div className="composer-bar">
          <div className="practice">
            <Switch on={chaos !== "off"} onChange={(on) => setChaos(on ? "default" : "off")} label="Practice mode" />
            <small>Adds realistic glitches (a server error, a renamed button, a fussy date field) so you can watch Clerk recover.</small>
          </div>
          {tech && (
            <label className="small muted">Chaos preset{" "}
              <select value={chaos} onChange={(e) => setChaos(e.target.value as ChaosPreset)} className="mono">
                <option value="off">off</option><option value="default">default</option><option value="rerun">rerun (bill already exists)</option>
              </select>
            </label>
          )}
          <button className="btn primary" disabled={busy || request.trim().length < 3} onClick={submit}>Start task {Icon.arrow}</button>
        </div>
      </section>

      <div className="assure">
        <span>{Icon.lock} Asks you before it changes anything in the ERP</span>
        <span>{Icon.shield} Double-checks the result on its own before reporting back</span>
        <span>{Icon.ask} Asks when something is unclear instead of guessing</span>
      </div>
      {health && !health.modelReady && <div className="panel" style={{ color: "var(--stop-ink)" }}>No AI model is configured. Set LLM_API_KEY and LLM_MODEL in .env and restart the agent API.</div>}
      {health && !(health.portal && health.erp) && <div className="panel" style={{ color: "var(--stop-ink)" }}>The Vendor Portal and ERP aren't reachable. Start them with <span className="mono">pnpm dev:mock</span>.</div>}
      {err && <div className="panel" style={{ color: "var(--stop-ink)" }}>{err}</div>}
      {tech && health && <div className="tech">model {health.model ?? "not set"} · chaos {chaos} · tracing {health.tracing ? "on" : "off"}</div>}

      <div className="home-grid">
        <section aria-labelledby="recent">
          <h2 id="recent" className="section">Recent tasks</h2>
          <div className="panel flush">
            {runs?.length === 0 && <div className="empty" style={{ padding: 22 }}>Nothing yet. Your tasks will show up here.</div>}
            <ul className="tasklist">{runs?.map((r) => <TaskRow key={r.id} r={r} />)}</ul>
          </div>
        </section>
        <section aria-labelledby="rules">
          <h2 id="rules" className="section">Company rules Clerk follows</h2>
          <div className="panel">
            <ul className="rules">
              {rules?.map((s) => (
                <li key={s.name}><span>{Icon.check("#1F7A4D", 14)}</span>
                  <span>{s.rule}{tech && <span className="mono faint small"> · playbook/{s.name}.md</span>}</span></li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </>
  );
}

export function TaskRow({ r }: { r: RunSummary }) {
  const { tech } = useTech();
  const finished = ["DONE", "NEEDS_ATTENTION", "FAILED"].includes(r.status);
  return (
    <li>
      <a href={`#/runs/${r.id}${finished ? "/report" : ""}`}>
        <span className="req">{r.request}</span>
        <StatusBadge status={r.status} />
        <span className="when">{ago(r.startedAt)}{tech ? ` · ${r.id} · chaos ${r.chaos} · ${r.step}/${r.maxSteps} steps${r.verified ? ` · checks ${r.verified}` : ""}` : ""}</span>
      </a>
    </li>
  );
}
