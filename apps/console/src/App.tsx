import { useEffect, useState } from "react";
import { useFetch, type Health } from "./api.js";
import { Switch, TechProvider, useTech } from "./ui.js";
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
  return <TechProvider><Shell /></TechProvider>;
}

function Shell() {
  const route = useRoute();
  const { tech, setTech } = useTech();
  const health = useFetch<Health>("/health").data;
  const m = route.match(/^\/runs\/(run_\d+)(\/report)?$/);
  const section = route === "/" ? "new" : route.startsWith("/evals") ? "evals" : "tasks";

  let page;
  if (m?.[2]) page = <ReportPage id={m[1]!} />;
  else if (m) page = <RunPage id={m[1]!} />;
  else if (route.startsWith("/evals")) page = <EvalsPage />;
  else if (route.startsWith("/runs")) page = <RunsPage />;
  else page = <NewTask />;

  const online = health ? health.portal && health.erp : null;
  return (
    <>
      <header className="topbar">
        <div className="topbar-in">
          <a href="#/" className="brand"><b>Clerk</b><span>for Acme Corp</span></a>
          <nav className="nav" aria-label="Primary">
            <a href="#/" className={section === "new" ? "on" : ""}>New task</a>
            <a href="#/runs" className={section === "tasks" ? "on" : ""}>Tasks</a>
            <a href="#/evals" className={section === "evals" ? "on" : ""}>Evals</a>
          </nav>
          <div className="topbar-right">
            <span className="online" title="Vendor Portal and ERP">
              <span className="dot" style={{ background: online === null ? "#8A938D" : online ? "#1F7A4D" : "#B42318" }} />
              <span className="online-label">{online === null ? "Checking systems" : online ? "Systems online" : "Systems offline"}</span>
            </span>
            <Switch on={tech} onChange={setTech} label="Technical details" />
          </div>
        </div>
      </header>
      <main className="page">{page}</main>
    </>
  );
}
