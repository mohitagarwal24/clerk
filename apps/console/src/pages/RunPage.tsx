import { Fragment, useState } from "react";
import type { ActionRecord, ApprovalRequest, Question } from "@clerk/shared";
import { answer, approve, elapsed, fileUrl, stopRun, useFetch, useNow, useRun, type Health, type RunView } from "../api.js";
import { Chip, Icon, statusLabel, statusTone, TAG_TONE } from "../ui.js";

const TERMINAL = ["DONE", "NEEDS_ATTENTION", "FAILED"];

export function RunPage({ id }: { id: string }) {
  const v = useRun(id);
  const health = useFetch<Health>("/health").data;
  const done = TERMINAL.includes(v.status);
  const now = useNow(!done);
  const pendingApproval = v.approvals.find((a) => !v.resolved[a.id]);
  const pendingQuestion = v.questions.find((q) => !(q.id in v.answers));
  const tone = statusTone(v.status);
  const verified = v.verification ? `${v.verification.criteria.filter((c) => c.pass).length}/${v.verification.criteria.length}` : undefined;

  return (
    <>
      <header className="run-head">
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0, flex: "1 1 520px" }}>
          <div className="crumbs">
            <span>{v.id}</span><span>/</span><span>chaos {v.chaos}</span><span>/</span>
            <span>step {v.step} of {v.maxSteps}</span><span>/</span><span>{elapsed(v.startedAt, v.endedAt ?? now)} elapsed</span>
          </div>
          <h1>{v.request || "…"}</h1>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span className={`status-pill ${tone}`}><span className="dot" style={{ background: "currentColor" }} />{statusLabel({ status: v.status, verified, stopReason: v.finished?.stopReason })}</span>
          {done ? <a className="btn dark" href={`#/runs/${id}/report`}>Open report</a>
            : <button className="btn ghost" onClick={() => stopRun(id)}>Stop run</button>}
        </div>
      </header>

      <LoopStrip v={v} />

      {v.error && <div className="card pad" style={{ borderColor: "#B42318", color: "#8A1C12" }}>{v.error}</div>}
      {done && v.finished && (
        <div className={`card pad`} style={{ borderColor: tone === "ok" ? "#1F7A4D" : "#B42318" }}>
          <div style={{ fontSize: 15, lineHeight: 1.5 }}><b>{v.finished.status === "DONE" ? "Done and verified." : v.finished.status === "FAILED" ? "Failed." : "Stopped, needs you."}</b> {v.finished.summary}</div>
          <a href={`#/runs/${id}/report`} className="mono" style={{ fontSize: 13 }}>See the verified report and evidence →</a>
        </div>
      )}

      <div className="cols-run">
        <aside className="side" aria-label="Goal and plan">
          <section className="card pad" aria-labelledby="crit">
            <h2 id="crit" className="eyebrow">Done means</h2>
            {!v.goal && <div className="muted" style={{ fontSize: 14 }}>Understanding the request…</div>}
            <ul className="crit">
              {v.goal?.success_criteria.map((c) => {
                const r = v.verification?.criteria.find((x) => x.id === c.id);
                return (
                  <li key={c.id}>
                    <span className="id">{c.id}</span>
                    <span>{c.check}<span className="src">{c.kind} · {c.source}</span></span>
                    {r && <span style={{ marginLeft: "auto" }}>{r.pass ? Icon.check() : <span style={{ color: "#B42318", fontWeight: 700 }}>✗</span>}</span>}
                  </li>
                );
              })}
            </ul>
            <p className="note">Fixed before acting, as checks with a source, not values. The verifier re-reads the source itself and checks the ERP record in code.</p>
          </section>

          <section className="card pad" aria-labelledby="plan">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 id="plan" className="eyebrow">Plan · revision {v.revision}</h2>
              {v.revision > 1 && <span className="mono" style={{ fontSize: 11, color: "#8A4B06" }}>replanned</span>}
            </div>
            <ol className="plan">
              {v.goal?.plan.map((p, i) => {
                const state = done && v.finished?.status === "DONE" ? "done" : i < v.planDone ? "done" : i === v.planDone ? "now" : "todo";
                return (
                  <li key={i} className={state}>
                    {state === "done" ? Icon.check() : <span className={`ring ${state === "now" ? "now" : ""}`} />}
                    <span>{p}</span>
                  </li>
                );
              })}
            </ol>
            {v.skills.length > 0 && <p className="note">skills loaded: {v.skills.join(", ")}</p>}
          </section>
        </aside>

        <section className="card" aria-labelledby="trace" style={{ overflow: "hidden" }}>
          <div className="card-head"><h2 id="trace">Action log</h2><span className="mono" style={{ fontSize: 11, color: "#4D5650" }}>newest first{done ? "" : " · streaming"}</span></div>
          {pendingApproval && <ApprovalCard runId={id} req={pendingApproval} />}
          {pendingQuestion && <QuestionCard runId={id} q={pendingQuestion} />}
          <ol className="steps">
            {[...v.actions].reverse().map((a) => <Step key={a.step} a={a} v={v} />)}
            {v.goal && (
              <li className="step">
                <span className="num">00</span>
                <div className="body">
                  <div className="title">Understood the goal, set {v.goal.success_criteria.length} success criteria</div>
                  <div style={{ fontSize: 13.5, color: "#2F3632", lineHeight: 1.5 }}>{v.goal.intent}. Loaded skills {v.skills.join(", ")}.</div>
                </div>
                <span className="tagc hide-sm"><Chip tone="neutral">PLAN</Chip></span>
              </li>
            )}
          </ol>
        </section>

        <aside className="side" aria-label="Live view and memory">
          <section className="browser" aria-labelledby="live">
            <div className="top"><h2 id="live" className="eyebrow" style={{ color: "#E9ECE6" }}>Live browser</h2><span className="url">{v.lastShot?.url.replace(/^https?:\/\//, "") ?? "about:blank"}</span></div>
            {v.lastShot?.screenshot ? <img src={fileUrl(id, v.lastShot.screenshot)} alt={`Screenshot at step ${v.lastShot.step}: ${v.lastShot.title}`} />
              : <div style={{ padding: 40, textAlign: "center" }} className="muted mono">no page yet</div>}
            <div className="foot">{pendingApproval ? "Paused: write held at the network gate" : v.lastShot ? `screenshot ${v.lastShot.step} · ${v.lastShot.title}` : "waiting for first page"}</div>
          </section>

          <section className="card pad" aria-labelledby="mem">
            <h2 id="mem" className="eyebrow">Working memory</h2>
            {Object.keys(v.facts).length === 0 ? <div className="muted mono" style={{ fontSize: 12.5 }}>(empty)</div> : (
              <dl className="memory">{Object.entries(v.facts).map(([k, val]) => <Fragment key={k}><dt>{k}</dt><dd>{val}</dd></Fragment>)}</dl>
            )}
          </section>

          <section className="stats" aria-label="Run stats">
            <div><span className="k">STEPS</span><span className="v">{v.step} / {v.maxSteps}</span></div>
            <div><span className="k">RECOVERIES</span><span className="v">{v.recoveries.length}</span></div>
            <div><span className="k">TOKENS</span><span className="v">{(v.usage.inputTokens + v.usage.outputTokens).toLocaleString()}</span></div>
            <div><span className="k">COST</span><span className="v">${v.usage.costUsd.toFixed(3)}</span></div>
          </section>
          {health?.phoenixUrl && <a className="btn ghost" href={health.phoenixUrl} target="_blank" rel="noreferrer" style={{ color: "#2238C9" }}>Open traces in Phoenix</a>}
        </aside>
      </div>
    </>
  );
}

function LoopStrip({ v }: { v: RunView }) {
  const adapts = v.actions.filter((a) => a.tag === "ADAPT" || a.tag === "RECOVER").length;
  const stages = ["Goal", "Understand", "Plan", "Execute", "Observe", "Adapt", "Verify", "Complete"];
  const executing = ["EXECUTING", "AWAITING_APPROVAL", "AWAITING_USER", "RECOVERING"].includes(v.status);
  const now = v.status === "UNDERSTANDING" ? (v.goal ? 2 : 1) : executing ? 3 : v.status === "VERIFYING" ? 6 : 7;
  const nowTone = v.status === "DONE" ? "ok" : v.status === "AWAITING_APPROVAL" || v.status === "AWAITING_USER" ? "wait" : ["NEEDS_ATTENTION", "FAILED"].includes(v.status) ? "stop" : "";
  const extra: Record<number, string> = { 4: v.observations ? ` · ×${v.observations}` : "", 5: adapts ? ` · ×${adapts}` : "" };
  return (
    <ol className="loop" aria-label="Agent loop">
      {stages.map((s, i) => (
        <li key={s} aria-current={i === now ? "step" : undefined} className={i === now ? `now ${nowTone}` : i > now && !(i === 4 || i === 5) ? "future" : ""}>
          <span className="n">{String(i + 1).padStart(2, "0")}{i === now ? (v.status === "AWAITING_APPROVAL" ? " · HELD" : v.status === "AWAITING_USER" ? " · ASKING" : " · NOW") : ""}{extra[i] ?? ""}</span>
          <span className="l">{s}</span>
        </li>
      ))}
    </ol>
  );
}

function Step({ a, v }: { a: ActionRecord; v: RunView }) {
  const recs = v.recoveries.filter((r) => r.step === a.step);
  const flags = v.injections.filter((f) => f.step === a.step);
  const args = Object.entries(a.args).map(([k, x]) => (k === "ref" || k === "file" || k === "url" || k === "system" ? JSON.stringify(x) : `${k}=${JSON.stringify(x)}`)).join(", ");
  return (
    <li className="step">
      <span className="num">{String(a.step).padStart(2, "0")}</span>
      <div className="body">
        <div className="title">{a.why || a.tool}</div>
        <div className="code">
          {a.tool}({args.length > 160 ? `${args.slice(0, 160)}…` : args}) <span className={a.ok ? "" : "fail"}>→ {a.result}</span>
          {recs.map((r, i) => <div key={i} style={{ color: "#6E3F05" }}>↻ {r.kind}: {r.detail}</div>)}
          {flags.map((f, i) => <div key={i} style={{ color: "#8A1C12" }}>⚑ text addressed to an AI agent in {f.where} · treated as data, not followed</div>)}
        </div>
      </div>
      <span className="tagc hide-sm"><Chip tone={TAG_TONE[a.tag] ?? "neutral"}>{a.tag}</Chip></span>
    </li>
  );
}

const TITLES: [RegExp, string][] = [
  [/^\/erp\/bills$/, "Create this bill in the ERP?"],
  [/^\/erp\/bills\/\d+\/status$/, "Change this bill's status?"],
  [/^\/erp\/vendors\/[^/]+$/, "Update this vendor record?"],
];

function ApprovalCard({ runId, req }: { runId: string; req: ApprovalRequest }) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(req.fields.map((f) => [f.name, f.value])));
  const [busy, setBusy] = useState(false);
  const prev = new Map(req.previous?.map((f) => [f.name, f.value]));
  const title = TITLES.find(([re]) => re.test(req.path))?.[1] ?? "Send this write to the ERP?";
  const send = async (approveIt: boolean) => {
    setBusy(true);
    const edited = Object.fromEntries(Object.entries(values).filter(([k, x]) => req.fields.find((f) => f.name === k)?.value !== x));
    await approve(runId, req.id, approveIt
      ? { approve: true, fields: Object.keys(edited).length ? edited : undefined }
      : { approve: false, note: prompt("Reason for rejecting (shown to the agent):") ?? undefined });
  };
  return (
    <div role="alertdialog" aria-labelledby="ap-title" className="approval">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="k">{req.step} · NETWORK GATE · {req.method} {req.path} held</span>
          <h3 id="ap-title">{title}</h3>
        </div>
        {req.previous && <span className="chip wait">re-approval: values changed</span>}
      </div>
      <table>
        <tbody>
          {req.fields.map((f) => {
            const was = prev.get(f.name);
            const changed = req.previous && was !== f.value;
            return (
              <tr key={f.name}>
                <th scope="row">{f.name}</th>
                <td>{editing ? <input value={values[f.name] ?? ""} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />
                  : changed ? <><span className="was">{was ?? "(none)"}</span><span className="chg">{f.value || "(empty)"}</span></> : (f.value || <span className="muted">(empty)</span>)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p>The browser tried to write to the ERP, so the request is held until you decide. Values above are parsed from the request itself, not from what the agent says it typed. Any change after approval asks again.</p>
      <div className="actions-row">
        <button className="btn dark" disabled={busy} onClick={() => send(true)}>{editing ? "Approve edited values" : "Approve and submit"}</button>
        <button className="btn wait-outline" disabled={busy} onClick={() => setEditing(!editing)}>{editing ? "Cancel edit" : "Edit values"}</button>
        <button className="btn wait-text" disabled={busy} onClick={() => send(false)}>Reject</button>
      </div>
    </div>
  );
}

function QuestionCard({ runId, q }: { runId: string; q: Question }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async (a: string) => { setBusy(true); await answer(runId, q.id, a); };
  return (
    <div role="alertdialog" aria-labelledby="q-title" className="approval question">
      <span className="k">{q.step} · CLERK IS ASKING</span>
      <h3 id="q-title">{q.question}</h3>
      {q.options?.length ? (
        <div className="actions-row">{q.options.map((o) => <button key={o} className="btn wait-outline" disabled={busy} onClick={() => send(o)}>{o}</button>)}</div>
      ) : null}
      <div className="actions-row">
        <input placeholder="Or type an answer" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) void send(text.trim()); }} style={{ flex: 1, minWidth: 220 }} />
        <button className="btn dark" disabled={busy || !text.trim()} onClick={() => send(text.trim())}>Answer</button>
      </div>
    </div>
  );
}
