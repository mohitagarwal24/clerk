import { Fragment } from "react";
import type { RunState } from "@clerk/shared";
import { fileUrl, useFetch, useRun, type RunDetail } from "../api.js";
import { Checks, Feed, ZoomImage } from "../components.js";
import { approvalDone, changedLabels, duration, humanize, Icon, useTech } from "../ui.js";

export function ReportPage({ id }: { id: string }) {
  const { data, error } = useFetch<RunDetail>(`/runs/${id}`);
  const view = useRun(id);
  const { tech } = useTech();
  if (error) return <div className="panel">{error}</div>;
  if (!data) return <div className="muted">Loading…</div>;
  const s = data.state;
  const v = s.verification;
  const blocked = s.finish?.outcome === "blocked";
  const tone = s.status === "DONE" ? "ok" : blocked ? "wait" : "stop";
  const passed = v ? v.criteria.filter((c) => c.pass).length : 0;
  const decided = s.approvals.filter((a) => a.decision);

  return (
    <>
      <section className={`outcome ${tone}`} aria-labelledby="verdict">
        <div className="icon">{tone === "ok" ? Icon.check("#134B2F", 30) : tone === "wait" ? Icon.pause("#6E3F05") : Icon.cross("#8A1C12", 30)}</div>
        <div>
          <div className="kicker">{s.status === "DONE" ? "Done, and checked independently" : blocked ? "Clerk stopped on purpose and needs you" : s.status === "FAILED" ? "Clerk couldn't finish this task" : "Clerk stopped and needs you"}</div>
          <h1 id="verdict">{s.finish?.summary ?? s.stopReason ?? "No summary."}</h1>
          <div className="task">Task: {s.request}</div>
          <div className="meta">
            Took {duration(s.startedAt, s.endedAt)}
            {v && v.criteria.length > 0 && !blocked && ` · ${passed} of ${v.criteria.length} checks passed`}{blocked && !s.approvals.some((a) => a.decision?.approve) && " · nothing was changed"}
            {decided.length > 0 && ` · ${decided.length} approval${decided.length > 1 ? "s" : ""} from you`}
          </div>
        </div>
      </section>

      <div className="report-grid">
        <div className="col">
          <section className="panel" aria-labelledby="checks">
            <h2 id="checks" className="section">{blocked ? "What the request would have needed" : "How we know it's right"}</h2>
            {s.goal && v ? <Checks criteria={s.goal.success_criteria} results={v.criteria} stopped={blocked} />
              : <div className="muted">No check ran: {s.stopReason ?? "the task stopped before finishing"}.</div>}
            {v && !blocked && <p className="small muted" style={{ margin: "14px 0 0" }}>A separate checker signed in on its own, re-read the source document, and compared the ERP record field by field. It never saw Clerk's notes.</p>}
            {v && blocked && <p className="small muted" style={{ margin: "14px 0 0" }}>Clerk stopped on purpose, so these were not expected to be met. {s.approvals.some((a) => a.decision?.approve) ? "" : "Nothing was changed in the ERP."}</p>}
          </section>

          <section className="panel" aria-labelledby="steps">
            <details>
              <summary><h2 id="steps" className="section" style={{ margin: 0, display: "inline" }}>Everything Clerk did ({s.step} steps) ›</h2></summary>
              <div style={{ marginTop: 14 }}><Feed v={view} live={false} /></div>
            </details>
          </section>

          <Evidence s={s} files={data.screenshots} />
          {tech && <TechReport s={s} traceUrl={data.traceUrl} />}
        </div>

        <div className="col">
          {s.finish?.answers.length ? (
            <section className="panel" aria-labelledby="result">
              <h2 id="result" className="section">Result</h2>
              <dl className="kv">{s.finish.answers.map((a) => <Fragment key={a.key}><dt>{humanize(a.key)}</dt><dd className="mono">{a.value}</dd></Fragment>)}</dl>
            </section>
          ) : null}

          <AlongTheWay s={s} />
          {(decided.length > 0 || s.questions.length > 0) && (
            <section className="panel" aria-labelledby="decisions">
              <h2 id="decisions" className="section">Your decisions</h2>
              <ul className="along">
                {decided.map((a) => (
                  <li key={a.id} className={a.decision!.approve ? "ok" : "stop"}>
                    You {a.decision!.approve ? "approved" : "rejected"} {a.previous ? `the corrected version (${changedLabels(a).join(", ") || "same values"} changed)` : approvalDone({ path: a.path, fields: a.sent ?? a.fields })}
                    {a.decision!.fields ? " with your edits" : ""}{a.decision!.note && !a.decision!.approve ? `: ${a.decision!.note}` : ""}
                  </li>
                ))}
                {s.questions.map((q) => <li key={q.id} className="wait">Clerk asked “{q.question}” You answered: {q.answer ?? "(no answer)"}</li>)}
              </ul>
            </section>
          )}
          <a className="btn primary" href="#/">Start another task</a>
        </div>
      </div>
    </>
  );
}

function AlongTheWay({ s }: { s: RunState }) {
  const items = [
    ...s.recoveries.map((r) => ({ step: r.step, tone: "wait", text: r.kind === "transient" ? "A system returned an error; Clerk waited and tried again." : r.kind === "stale_ref" ? "A page changed while Clerk was using it; it looked again and carried on." : r.detail })),
    ...s.injectionFlags.map((f) => ({ step: f.step, tone: "stop", text: "A document contained an instruction aimed at AI agents (to change bank details). Clerk ignored it." })),
    ...s.approvals.filter((a) => a.previous).map((a) => ({ step: a.step, tone: "agent", text: `The ERP rejected the first attempt, so Clerk corrected ${changedLabels(a).join(", ").toLowerCase() || "the values"} and asked you again.` })),
  ].sort((a, b) => a.step - b.step);
  // The same kind of event twice reads better as one line with a count.
  const grouped = items.reduce<{ tone: string; text: string; n: number }[]>((acc, x) => {
    const hit = acc.find((y) => y.text === x.text);
    if (hit) hit.n++; else acc.push({ tone: x.tone, text: x.text, n: 1 });
    return acc;
  }, []);
  return (
    <section className="panel" aria-labelledby="along">
      <h2 id="along" className="section">What came up along the way</h2>
      {grouped.length ? <ul className="along">{grouped.map((x, i) => <li key={i} className={x.tone}>{x.text}{x.n > 1 ? ` (${x.n} times)` : ""}</li>)}</ul> : <div className="muted">Nothing unexpected.</div>}
    </section>
  );
}

function Evidence({ s, files }: { s: RunState; files: string[] }) {
  const pick = [...new Set([files[Math.floor(files.length / 3)], files.at(-1)])].filter((f): f is string => !!f);
  const shots = pick.map((f) => ({ src: `screenshots/${f}`, cap: `Step ${Number(f.replace(".png", ""))}` }));
  if (s.verification?.readback?.screenshot) shots.push({ src: s.verification.readback.screenshot, cap: "What the checker saw in the ERP" });
  return (
    <section className="panel" aria-labelledby="evidence">
      <h2 id="evidence" className="section">Evidence</h2>
      <div className="shots">{shots.map((x) => <figure key={x.src}><ZoomImage src={fileUrl(s.id, x.src)} alt={x.cap} /><figcaption>{x.cap}</figcaption></figure>)}</div>
      {s.downloads.length > 0 && (
        <p className="small" style={{ margin: "14px 0 0" }}>
          Source {s.downloads.length > 1 ? "documents" : "document"}: {s.downloads.map((d) => <a key={d.name} href={fileUrl(s.id, `downloads/${d.name}`)} target="_blank" rel="noreferrer" style={{ marginRight: 10 }}>{Icon.doc} {d.name}</a>)}
        </p>
      )}
    </section>
  );
}

function TechReport({ s, traceUrl }: { s: RunState; traceUrl: string | null }) {
  const v = s.verification;
  return (
    <section className="panel tech-panel">
      <h2 className="section">Verification internals</h2>
      <dl className="kv small">
        <dt>Run</dt><dd className="mono">{s.id} · chaos {s.chaos} · {s.status} · {s.step}/{s.maxSteps} steps</dd>
        <dt>Model use</dt><dd className="mono">{s.usage.calls} calls · {(s.usage.inputTokens + s.usage.outputTokens).toLocaleString()} tokens · ${s.usage.costUsd.toFixed(4)}</dd>
        {v?.source && <><dt>Source re-check</dt><dd>{v.source.ok ? "ok" : "NOT OK"} · {v.source.document} · re-read {Object.entries(v.source.values).map(([k, x]) => `${k}=${x}`).join(", ")}</dd></>}
        {v?.readback && <><dt>LLM read-back</dt><dd>{v.readback.comment} <span className="faint">(evidence only, never decides)</span></dd></>}
        {s.stopReason && <><dt>Stop reason</dt><dd>{s.stopReason}</dd></>}
        <dt>Files</dt><dd className="mono">
          <a href={fileUrl(s.id, "summary.md")} target="_blank" rel="noreferrer">summary.md</a> · <a href={fileUrl(s.id, "actions.jsonl")} target="_blank" rel="noreferrer">actions.jsonl</a> · <a href={fileUrl(s.id, "verification.json")} target="_blank" rel="noreferrer">verification.json</a> · <a href={fileUrl(s.id, "events.jsonl")} target="_blank" rel="noreferrer">events.jsonl</a>
        </dd>
        {traceUrl && <><dt>Trace</dt><dd><a href={traceUrl} target="_blank" rel="noreferrer">Open in Phoenix</a></dd></>}
      </dl>
    </section>
  );
}
