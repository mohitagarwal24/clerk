import { useFetch, type RunSummary } from "../api.js";
import { TaskRow } from "./NewTask.js";

export function RunsPage() {
  const { data, error } = useFetch<RunSummary[]>("/runs?limit=100");
  return (
    <>
      <header className="hero"><h1>Tasks</h1><p>Everything Clerk has worked on, newest first. Open one to see the result and the evidence.</p></header>
      <div className="panel flush">
        {error && <div className="empty" style={{ padding: 22 }}>{error}</div>}
        {data?.length === 0 && <div className="empty" style={{ padding: 22 }}>No tasks yet. <a href="#/">Start one</a>.</div>}
        <ul className="tasklist">{data?.map((r) => <TaskRow key={r.id} r={r} />)}</ul>
      </div>
    </>
  );
}
