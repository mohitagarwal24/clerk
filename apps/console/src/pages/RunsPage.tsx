import { useFetch, type RunSummary } from "../api.js";
import { RunRow } from "./NewTask.js";

export function RunsPage() {
  const { data, error } = useFetch<RunSummary[]>("/runs?limit=100");
  return (
    <>
      <header style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div className="eyebrow">Runs · evidence in runs/&lt;id&gt;/</div>
        <h1 style={{ margin: 0, fontSize: 40, fontWeight: 800, letterSpacing: "-.03em" }}>All runs</h1>
      </header>
      <section className="card" style={{ overflow: "hidden" }}>
        {error && <div className="empty">{error}</div>}
        {data?.length === 0 && <div className="empty">No runs yet. <a href="#/">Start one</a>.</div>}
        {data?.map((r) => <RunRow key={r.id} r={r} />)}
      </section>
    </>
  );
}
