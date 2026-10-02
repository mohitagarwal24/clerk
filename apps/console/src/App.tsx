import { useEffect, useState } from "react";
import { Icon } from "./ui.js";
import { NewTask } from "./pages/NewTask.js";
import { RunPage } from "./pages/RunPage.js";
import { ReportPage } from "./pages/ReportPage.js";
import { EvalsPage } from "./pages/EvalsPage.js";
import { RunsPage } from "./pages/RunsPage.js";

/** Hash routes: #/  #/runs  #/runs/:id  #/runs/:id/report  #/evals */
function useRoute() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => { setHash(location.hash); window.scrollTo(0, 0); };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return hash.replace(/^#/, "") || "/";
}


export function App() {
  const route = useRoute();
  const m = route.match(/^\/runs\/(run_\d+)(\/report)?$/);
  const section = route === "/" ? "new" : route.startsWith("/evals") ? "evals" : m?.[2] ? "report" : "runs";
  let page;
  if (m && m[2]) page = <ReportPage id={m[1]!} />;
  else if (m) page = <RunPage id={m[1]!} />;
  else if (route.startsWith("/evals")) page = <EvalsPage />;
  else if (route.startsWith("/runs")) page = <RunsPage />;
  else page = <NewTask />;

  const latest = m?.[1];
  return (
    <div className="shell">
      <nav className="rail" aria-label="Primary">
        <div className="railnav">
          <a href="#/" className="logo" aria-label="Clerk home">C</a>
          <a href="#/" className={`item ${section === "new" ? "on" : ""}`} aria-label="New task" title="New task">{Icon.plus}</a>
          <a href={latest ? `#/runs/${latest}` : "#/runs"} className={`item ${section === "runs" ? "on" : ""}`} aria-label="Runs" title="Runs">{Icon.runs}</a>
          <a href={latest ? `#/runs/${latest}/report` : "#/runs"} className={`item ${section === "report" ? "on" : ""}`} aria-label="Evidence" title="Evidence">{Icon.shield}</a>
          <a href="#/evals" className={`item ${section === "evals" ? "on" : ""}`} aria-label="Evals" title="Evals">{Icon.evals}</a>
        </div>
        <div className="tag">ACME CORP · SANDBOX</div>
      </nav>
      <main className="main">{page}</main>
    </div>
  );
}
