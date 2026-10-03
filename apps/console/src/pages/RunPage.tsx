import { Fragment, useState } from "react";
import type { ApprovalRequest, Question } from "@clerk/shared";
import { answer, approve, fileUrl, stopRun, useFetch, useNow, useRun, useVendorName, type Health, type RunView } from "../api.js";
import { Checks, Feed, ZoomImage } from "../components.js";
import { currentActivity } from "../feed.js";
import { approvalTitle, duration, fieldLabel, Icon, inr, StatusBadge, statusTone, useTech } from "../ui.js";

const TERMINAL = ["DONE", "NEEDS_ATTENTION", "FAILED"];

export function RunPage({ id }: { id: string }) {
  const v = useRun(id);
  const { tech } = useTech();
  const done = TERMINAL.includes(v.status);
  const now = useNow(!done);
  const vendorName = useVendorName();
  const pendingApproval = v.approvals.find((a) => !v.resolved[a.id]);
  const pendingQuestion = v.questions.find((q) => !(q.id in v.answers));

  return (
    <>
      <header className="run-head">
        <div>
          <h1>{v.request || "…"}</h1>
          <div className="status">
            <StatusBadge status={v.status} />
            {!done && !pendingApproval && !pendingQuestion && <span className="now">{currentActivity(v)}</span>}
            <span className="faint small">{duration(v.startedAt, v.endedAt ?? now)}</span>
            {v.chaos !== "off" && <span className="faint small">· practice mode</span>}
          </div>
        </div>
        {done ? <a className="btn dark" href={`#/runs/${id}/report`}>See the result {Icon.arrow}</a>
          : <button className="btn quiet" onClick={() => stopRun(id)}>Stop</button>}
      </header>

      <Phases v={v} />

      {pendingApproval && <ApprovalSheet runId={id} req={pendingApproval} vendorName={vendorName} />}
      {pendingQuestion && <QuestionSheet runId={id} q={pendingQuestion} />}
      {v.error && <div className="panel" style={{ color: "var(--stop-ink)" }}>{v.error}</div>}

      <div className="run-grid">
        <section aria-labelledby="activity">
          <h2 id="activity" className="section">What Clerk is doing</h2>
          <div className="panel">
            {!v.goal && !done ? <div className="working" style={{ color: "var(--agent-ink)", fontWeight: 600 }}><span className="dot pulse" style={{ background: "currentColor", marginRight: 8 }} />Reading your request and the company rules…</div>
              : <Feed v={v} live={!done} />}
          </div>
        </section>

        <aside className="side" aria-label="Live view and checks">
          <section className={`live ${pendingApproval ? "paused" : ""}`} aria-label="Live view">
            <div className="bar">
              <b>{pendingApproval ? "Paused for your approval" : done ? "Last screen" : "Live view"}</b>
              <span className="url">{v.lastShot?.url.replace(/^https?:\/\/[^/]+/, "") ?? ""}</span>
            </div>
            {v.lastShot?.screenshot ? <ZoomImage src={fileUrl(id, v.lastShot.screenshot)} alt={`What Clerk saw: ${v.lastShot.title}`} />
              : <div className="placeholder">The browser view appears once Clerk opens a page</div>}
          </section>

          {v.goal && (
            <section className="panel" aria-labelledby="done-means">
              <h2 id="done-means" className="section">Done means</h2>
              <Checks criteria={v.goal.success_criteria} results={v.verification?.criteria} />
              <p className="small muted" style={{ margin: "14px 0 0" }}>Set before Clerk starts. When it finishes, a separate check re-reads the source and the ERP to confirm each one.</p>
            </section>
          )}

          {tech && <TechPanel v={v} />}
        </aside>
      </div>
    </>
  );
}

function Phases({ v }: { v: RunView }) {
  const labels = ["Understand", "Do the work", "Double-check", "Done"];
  const i = v.status === "UNDERSTANDING" ? 0 : v.status === "VERIFYING" ? 2 : TERMINAL.includes(v.status) ? 3 : 1;
  const tone = statusTone(v.status);
  const nowTone = tone === "wait" ? "wait" : v.status === "DONE" ? "ok" : tone === "stop" ? "stop" : "";
  return (
    <div className="phases" aria-label="Progress">
      {labels.map((l, k) => (
        <div key={l} className={`phase ${k < i ? "done" : k === i ? `now ${nowTone}` : ""}`} aria-current={k === i ? "step" : undefined}>
          <span className="bar" />
          <span>{k === i && tone === "wait" ? "Waiting for you" : k === 3 && v.status !== "DONE" && k === i ? "Stopped" : l}</span>
        </div>
      ))}
    </div>
  );
}

function TechPanel({ v }: { v: RunView }) {
  const adapts = v.actions.filter((a) => a.tag === "ADAPT" || a.tag === "RECOVER").length;
  return (
    <section className="panel tech-panel">
      <h2 className="section">Run</h2>
      <dl className="kv small">
        <dt>Run</dt><dd className="mono">{v.id} · chaos {v.chaos}</dd>
        <dt>Status</dt><dd className="mono">{v.status}{v.statusNote ? ` (${v.statusNote})` : ""}</dd>
        <dt>Steps</dt><dd className="mono">{v.step} / {v.maxSteps} · {v.observations} observations · {adapts} adapt/recover</dd>
        <dt>Model use</dt><dd className="mono">{v.usage.calls} calls · {(v.usage.inputTokens + v.usage.outputTokens).toLocaleString()} tokens · ${v.usage.costUsd.toFixed(4)}</dd>
        <dt>Skills</dt><dd className="mono">{v.skills.join(", ") || "-"}</dd>
      </dl>
      {v.goal && (
        <>
          <h2 className="section" style={{ marginTop: 18 }}>Plan r{v.revision}</h2>
          <ol className="small" style={{ margin: 0, paddingLeft: 20 }}>
            {v.goal.plan.map((p, i) => <li key={i} style={{ color: i < v.planDone ? "var(--faint)" : undefined }}>{p}</li>)}
          </ol>
        </>
      )}
      <h2 className="section" style={{ marginTop: 18 }}>Working memory</h2>
      {Object.keys(v.facts).length ? <dl className="kv small mono">{Object.entries(v.facts).map(([k, x]) => <Fragment key={k}><dt>{k}</dt><dd>{x}</dd></Fragment>)}</dl> : <div className="small muted">(empty)</div>}
    </section>
  );
}

function ApprovalSheet({ runId, req, vendorName }: { runId: string; req: ApprovalRequest; vendorName: (id: string) => string | undefined }) {
  const { tech } = useTech();
  const [mode, setMode] = useState<"view" | "edit" | "reject">("view");
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(req.fields.map((f) => [f.name, f.value])));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const prev = req.previous ? new Map(req.previous.map((f) => [f.name, f.value])) : undefined;

  const send = async (approveIt: boolean) => {
    setBusy(true);
    if (!approveIt) return void approve(runId, req.id, { approve: false, note: reason.trim() || undefined });
    const edited = Object.fromEntries(Object.entries(values).filter(([k, x]) => req.fields.find((f) => f.name === k)?.value !== x));
    await approve(runId, req.id, { approve: true, fields: Object.keys(edited).length ? edited : undefined });
  };

  const show = (name: string, value: string) => {
    if (!value) return <span className="nochange">empty</span>;
    if (name === "vendor_id") return vendorName(value) ? <><span className="name">{vendorName(value)}</span><span className="hint">{value}</span></> : value;
    if (name === "amount") return <>{value}<span className="hint">{inr(value)}</span></>;
    return value;
  };

  return (
    <section className="sheet" role="alertdialog" aria-labelledby="ap-title">
      <span className="kicker">{Icon.lock} Clerk needs your approval{req.previous ? " again: some values changed" : ""}</span>
      <h2 id="ap-title">{approvalTitle(req, vendorName)}</h2>
      <dl className="fields">
        {req.fields.map((f) => {
          const changed = prev && prev.get(f.name) !== f.value;
          return (
            <Fragment key={f.name}>
              <dt>{fieldLabel(f.name)}</dt>
              <dd>
                {mode === "edit" ? <input value={values[f.name] ?? ""} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} aria-label={fieldLabel(f.name)} />
                  : changed ? <><span className="was">{prev!.get(f.name) || "empty"}</span><span className="changed">{show(f.name, f.value)}</span></>
                  : show(f.name, f.value)}
              </dd>
            </Fragment>
          );
        })}
      </dl>
      <p>These are the exact values the browser is about to send to the ERP, read from the request itself. Nothing is saved until you approve.{tech && <span className="mono"> · {req.method} {req.path} held at step {req.step} ({req.id})</span>}</p>
      {mode === "reject" && <textarea rows={2} placeholder="Why? Clerk will see this (optional)" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />}
      <div className="actions">
        {mode === "reject" ? (
          <>
            <button className="btn dark" disabled={busy} onClick={() => send(false)}>Reject this change</button>
            <button className="btn text" onClick={() => setMode("view")}>Back</button>
          </>
        ) : (
          <>
            <button className="btn dark" disabled={busy} onClick={() => send(true)}>{mode === "edit" ? "Approve with my edits" : "Approve"}</button>
            <button className="btn wait-line" disabled={busy} onClick={() => setMode(mode === "edit" ? "view" : "edit")}>{mode === "edit" ? "Cancel edits" : "Edit values"}</button>
            <button className="btn text" disabled={busy} onClick={() => setMode("reject")}>Reject</button>
          </>
        )}
      </div>
    </section>
  );
}

function QuestionSheet({ runId, q }: { runId: string; q: Question }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async (a: string) => { setBusy(true); await answer(runId, q.id, a); };
  return (
    <section className="sheet" role="alertdialog" aria-labelledby="q-title">
      <span className="kicker">{Icon.ask} Clerk has a question before it continues</span>
      <h2 id="q-title">{q.question}</h2>
      {q.options?.length ? <div className="options">{q.options.map((o) => <button key={o} className="btn wait-line" disabled={busy} onClick={() => send(o)}>{o}</button>)}</div> : null}
      <div className="actions">
        <input className="mono" style={{ flex: 1, minWidth: 240, padding: "10px 12px", border: "1px solid var(--wait)", borderRadius: 10 }} placeholder={q.options?.length ? "Or type a different answer" : "Type your answer"}
          value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) void send(text.trim()); }} />
        <button className="btn dark" disabled={busy || !text.trim()} onClick={() => send(text.trim())}>Send</button>
      </div>
    </section>
  );
}
