import { useFetch, type EvalsData } from "../api.js";

export function EvalsPage() {
  const { data, error } = useFetch<EvalsData>("/evals");
  const results = data?.results?.results ?? [];
  const byId = new Map(results.map((r) => [r.id, r]));
  const steps = results.map((r) => r.steps).sort((a, b) => a - b);
  const median = steps.length ? steps[Math.floor(steps.length / 2)] : null;
  const secs = results.length ? results.reduce((s, r) => s + r.ms, 0) / results.length / 1000 : null;
  const n = data?.cases.length ?? 0;

  return (
    <>
      <header className="hero">
        <h1>Does it generalise?</h1>
        <p>Requests Clerk was never tuned on, run on frozen code with practice-mode glitches on. A case passes when the independent checks pass, or when Clerk correctly stops and asks.</p>
      </header>

      <section className="tiles" aria-label="Summary">
        <div><span className="k">Passed</span><span className="v">{results.length ? `${results.filter((r) => r.pass).length} / ${results.length}` : `– / ${n}`}</span></div>
        <div><span className="k">Median steps</span><span className="v">{median ?? "–"}</span></div>
        <div><span className="k">Recoveries</span><span className="v">{results.length ? results.reduce((s, r) => s + r.recoveries, 0) : "–"}</span></div>
        <div><span className="k">Average time</span><span className="v">{secs !== null ? `${Math.round(secs / 60)}m ${Math.round(secs % 60)}s` : "–"}</span></div>
      </section>

      <div className="panel flush">
        {error && <div className="empty" style={{ padding: 22 }}>{error}</div>}
        <div className="erow head"><span>ID</span><span>Request</span><span className="hide-sm">Expected</span><span className="hide-sm">Steps</span><span>Result</span></div>
        {data?.cases.map((c) => {
          const r = byId.get(c.id);
          return (
            <div key={c.id} className="erow">
              <span className="mono faint small">{c.id}</span>
              <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>{c.request}
                <span className="small muted">{c.tag}{r && !r.pass ? ` · ${r.reasons.join("; ")}` : ""}</span></span>
              <span className="small muted hide-sm">{c.expect}</span>
              <span className="mono small muted hide-sm">{r ? r.steps : "–"}</span>
              <span>{r ? <a href={`#/runs/${r.runId}/report`} className={`badge ${r.pass ? "ok" : "stop"}`} style={{ textDecoration: "none" }}>{r.pass ? "Pass" : "Fail"}</a> : <span className="badge" style={{ background: "var(--surface-2)", color: "var(--muted)" }}>Not run</span>}</span>
            </div>
          );
        })}
      </div>
      <p className="small muted">Run them with <code className="cmd">pnpm evals</code>{data?.results ? ` · last run ${new Date(data.results.ranAt).toLocaleString()} on ${data.results.model}` : ""}</p>
    </>
  );
}
