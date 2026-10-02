import { useFetch, type EvalsData } from "../api.js";
import { Chip } from "../ui.js";

export function EvalsPage() {
  const { data, error } = useFetch<EvalsData>("/evals");
  const results = data?.results?.results ?? [];
  const byId = new Map(results.map((r) => [r.id, r]));
  const steps = results.map((r) => r.steps).sort((a, b) => a - b);
  const median = steps.length ? steps[Math.floor(steps.length / 2)] : null;
  const cost = results.length ? results.reduce((s, r) => s + r.costUsd, 0) / results.length : null;
  const recovered = results.reduce((s, r) => s + r.recoveries, 0);
  const n = data?.cases.length ?? 0;

  return (
    <>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 20, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="eyebrow">Evals · frozen code · held-out requests</div>
          <h1 style={{ margin: 0, fontSize: 44, lineHeight: 1.05, fontWeight: 800, letterSpacing: "-.03em" }}>Does it generalize?</h1>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: "#2F3632", maxWidth: 640 }}>Each case runs through the same loop, gate and verifier, most with chaos on. Pass means the deterministic checks passed, or the agent correctly stopped and asked.</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
          <code className="cmd">pnpm evals</code>
          <span className="note">{data?.results ? `last run ${new Date(data.results.ranAt).toLocaleString()} · ${data.results.model}` : "not run yet"}</span>
        </div>
      </header>

      <section aria-label="Summary" className="tiles">
        <div><span className="k">PASSED</span><span className="v">{results.length ? `${results.filter((r) => r.pass).length} / ${results.length}` : `– / ${n}`}</span></div>
        <div><span className="k">MEDIAN STEPS</span><span className="v">{median ?? "–"}</span></div>
        <div><span className="k">RECOVERIES</span><span className="v">{results.length ? recovered : "–"}</span></div>
        <div><span className="k">COST PER RUN</span><span className="v">{cost !== null ? `$${cost.toFixed(3)}` : "–"}</span></div>
      </section>

      <section className="card" aria-labelledby="cases" style={{ overflow: "hidden" }}>
        <div className="card-head"><h2 id="cases">Cases</h2><span className="mono" style={{ fontSize: 11.5, color: "#4D5650" }}>evals/cases.json · results in evals/results.md</span></div>
        {error && <div className="empty">{error}</div>}
        <div className="erow head"><span>ID</span><span>REQUEST</span><span className="hide-sm">EXPECTED</span><span className="hide-sm">STEPS</span><span>RESULT</span></div>
        {data?.cases.map((c) => {
          const r = byId.get(c.id);
          return (
            <div key={c.id} className="erow">
              <span className="mono" style={{ fontSize: 12, color: "#8A938D" }}>{c.id}</span>
              <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>{c.request}
                <span className="mono" style={{ fontSize: 10.5, color: "#4D5650" }}>{c.tag} · chaos {c.chaos}{r && !r.pass ? ` · ${r.reasons.join("; ")}` : ""}</span></span>
              <span className="mono hide-sm" style={{ fontSize: 12, color: "#2F3632" }}>{c.expect}</span>
              <span className="mono hide-sm" style={{ fontSize: 12, color: "#4D5650" }}>{r ? r.steps : "–"}</span>
              <span>{r ? <a href={`#/runs/${r.runId}/report`} style={{ textDecoration: "none" }}><Chip tone={r.pass ? "ok" : "stop"}>{r.pass ? "PASS" : "FAIL"} · {r.status === "DONE" ? "done" : r.status === "NEEDS_ATTENTION" ? "stopped" : r.status.toLowerCase()}</Chip></a> : <Chip tone="neutral">NOT RUN</Chip>}</span>
            </div>
          );
        })}
      </section>
    </>
  );
}
