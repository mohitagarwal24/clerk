import type { RunState } from "@clerk/shared";
import { elapsed, fileUrl, useFetch, type RunDetail } from "../api.js";
import { Chip, Icon } from "../ui.js";

export function ReportPage({ id }: { id: string }) {
  const { data, error } = useFetch<RunDetail>(`/runs/${id}`);
  if (error) return <div className="card pad">{error}</div>;
  if (!data) return <div className="muted">Loading…</div>;
  const s = data.state;
  const v = s.verification;
  const tone = s.status === "DONE" ? "ok" : s.status === "FAILED" ? "stop" : s.finish?.outcome === "blocked" ? "wait" : "stop";
  const passed = v ? v.criteria.filter((c) => c.pass).length : 0;
  const approvals = s.approvals.filter((a) => a.decision).length;

  return (
    <>
      <div className="crumbs">
        <a href={`#/runs/${id}`}>{id}</a><span>/</span><span>{s.step} steps</span><span>/</span><span>{s.recoveries.length} recoveries</span><span>/</span>
        <span>{approvals} approvals</span><span>/</span><span>{elapsed(s.startedAt, s.endedAt)}</span><span>/</span><span>chaos {s.chaos}</span>
      </div>

      <section aria-labelledby="verdict" className={`verdict ${tone}`}>
        <div className="icon" style={{ background: tone === "ok" ? "#D7EDDF" : tone === "wait" ? "#FBEBD3" : "#F6DAD6" }}>
          {tone === "ok" ? Icon.check("#133D28", 38) : tone === "wait" ? Icon.pause("#6E3F05") : Icon.cross("#8A1C12")}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          <span className="mono" style={{ fontSize: 12, letterSpacing: ".12em", opacity: 0.8 }}>
            {s.status === "DONE" ? `VERIFIED · ${passed} OF ${v?.criteria.length} · SOURCE RE-CHECK + ERP RECORD CHECK`
              : s.status === "FAILED" ? "FAILED" : `NEEDS ATTENTION${v ? ` · CHECKS ${passed} OF ${v.criteria.length}` : ""}`}
          </span>
          <h1 id="verdict">{s.status === "DONE" ? "Done. " : s.finish?.outcome === "blocked" ? "Stopped on purpose. " : ""}{s.finish?.summary ?? s.stopReason ?? s.request}</h1>
        </div>
      </section>

      <div className="cols-report">
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <section className="card" aria-labelledby="checks" style={{ overflow: "hidden" }}>
            <div className="card-head"><h2 id="checks">What the verifier checked</h2><span className="mono" style={{ fontSize: 11.5, color: "#4D5650" }}>fresh browser login · never saw the agent's facts or reasoning</span></div>
            {!v && <div className="empty">No verification ran ({s.stopReason ?? "the run stopped before finishing"}).</div>}
            {v && (
              <>
                <div className="critrow head"><span>ID</span><span>CRITERION</span><span className="hide-sm">EXPECTED</span><span className="hide-sm">FOUND</span><span>RESULT</span></div>
                {v.criteria.map((c) => (
                  <div key={c.id} className="critrow">
                    <span className="mono" style={{ color: "#8A938D", fontSize: 12 }}>{c.id}</span>
                    <span>{c.check}<span className="how">{c.how}{c.note ? ` · ${c.note}` : ""}</span></span>
                    <span className="val hide-sm">{c.expected}</span>
                    <span className="val hide-sm">{c.found}</span>
                    <span><Chip tone={c.pass ? "ok" : "stop"}>{c.pass ? "PASS" : "FAIL"}</Chip></span>
                  </div>
                ))}
                {v.source && <div className="note" style={{ padding: "12px 20px", borderTop: "1px solid #E1E5DE" }}>Source re-check: {v.source.ok ? "ok" : "NOT OK"} · {v.source.document} · re-read {Object.entries(v.source.values).map(([k, x]) => `${k}=${x}`).join(", ") || "nothing"}</div>}
                {v.readback && <div className="note" style={{ padding: "0 20px 14px" }}>LLM read-back (evidence only, never decides): {v.readback.comment}</div>}
              </>
            )}
          </section>
          <Evidence s={s} files={data.screenshots} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <section className="card pad" aria-labelledby="summary">
            <h2 id="summary" style={{ margin: 0, fontSize: 17 }}>Summary</h2>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55 }}>{s.finish?.summary ?? s.stopReason}</p>
            {s.finish?.answers.length ? <dl className="memory">{s.finish.answers.map((a) => [<dt key={`k${a.key}`}>{a.key}</dt>, <dd key={`v${a.key}`}>{a.value}</dd>])}</dl> : null}
            <div className="note">{s.usage.calls} model calls · {(s.usage.inputTokens + s.usage.outputTokens).toLocaleString()} tokens · est. ${s.usage.costUsd.toFixed(4)}</div>
          </section>
          <Hiccups s={s} />
          {s.questions.length > 0 && (
            <section className="card pad"><h2 style={{ margin: 0, fontSize: 17 }}>Questions asked</h2>
              <ul className="hiccups">{s.questions.map((q) => <li key={q.id}><span className="mono" style={{ fontSize: 12, color: "#8A938D" }}>{String(q.step).padStart(2, "0")}</span><span>{q.question} <b>→ {q.answer ?? "(unanswered)"}</b></span></li>)}</ul>
            </section>
          )}
          <section aria-label="Actions" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <a className="btn dark" href={fileUrl(id, "summary.md")} target="_blank" rel="noreferrer">Evidence summary (runs/{id}/summary.md)</a>
            <a className="btn ghost" href={fileUrl(id, "actions.jsonl")} target="_blank" rel="noreferrer">actions.jsonl</a>
            {data.traceUrl && <a className="btn ghost" href={data.traceUrl} target="_blank" rel="noreferrer">Open trace in Phoenix</a>}
            <a href="#/" style={{ textAlign: "center", fontWeight: 600, padding: 12 }}>Run another task</a>
          </section>
        </div>
      </div>
    </>
  );
}

function Hiccups({ s }: { s: RunState }) {
  const items: { step: number; text: string }[] = [
    ...s.recoveries.map((r) => ({ step: r.step, text: r.kind === "transient" ? `Server error, retried: ${r.detail}.` : r.kind === "stale_ref" ? "The page changed under the agent (stale element). It re-read the page and picked again." : `${r.kind}: ${r.detail}` })),
    ...s.injectionFlags.map((f) => ({ step: f.step, text: `Text in ${f.where} was addressed to an AI agent ("${f.text.slice(0, 90)}…"). Ignored and flagged.` })),
    ...s.approvals.filter((a) => a.previous).map((a) => ({ step: a.step, text: `Resubmitted ${a.path} with changed values; you were asked again.` })),
    ...s.approvals.filter((a) => a.decision && !a.decision.approve).map((a) => ({ step: a.step, text: `You rejected ${a.method} ${a.path}${a.decision?.note ? `: ${a.decision.note}` : ""}.` })),
  ].sort((a, b) => a.step - b.step);
  return (
    <section className="card pad" aria-labelledby="hiccups">
      <h2 id="hiccups" style={{ margin: 0, fontSize: 17 }}>What went wrong along the way</h2>
      {items.length === 0 ? <div className="muted" style={{ fontSize: 14 }}>Nothing. Clean run.</div> : (
        <ul className="hiccups">{items.map((x, i) => <li key={i}><span className="mono" style={{ fontSize: 12, color: "#8A938D" }}>{String(x.step).padStart(2, "0")}</span><span>{x.text}</span></li>)}</ul>
      )}
    </section>
  );
}

function Evidence({ s, files }: { s: RunState; files: string[] }) {
  // A few telling screenshots: first page, mid-run, the last agent page, and the verifier's read-back.
  const pick = [...new Set([files[1] ?? files[0], files[Math.floor(files.length / 2)], files.at(-1)])].filter((f): f is string => !!f);
  const shots = pick.map((f, i) => ({ src: `screenshots/${f}`, cap: `${f.replace(".png", "").replace(/^0/, "")} · ${["early page", "mid-run", "last page"][pick.length === 3 ? i : i === pick.length - 1 ? 2 : i]}` }));
  if (s.verification?.readback?.screenshot) shots.push({ src: s.verification.readback.screenshot, cap: "V · verifier read-back" });
  return (
    <section aria-labelledby="shots" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 id="shots" style={{ margin: 0, fontSize: 17 }}>Evidence</h2><span className="mono" style={{ fontSize: 11.5, color: "#4D5650" }}>runs/{s.id}/</span>
      </div>
      <div className="shots">
        {shots.map((x) => (
          <figure key={x.src}><a href={fileUrl(s.id, x.src)} target="_blank" rel="noreferrer"><img src={fileUrl(s.id, x.src)} alt={x.cap} onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }} /></a><figcaption>{x.cap}</figcaption></figure>
        ))}
      </div>
      {s.downloads.length > 0 && <div className="note">Source documents: {s.downloads.map((d) => <a key={d.name} href={fileUrl(s.id, `downloads/${d.name}`)} target="_blank" rel="noreferrer" style={{ marginRight: 10 }}>{d.name}</a>)}</div>}
    </section>
  );
}
