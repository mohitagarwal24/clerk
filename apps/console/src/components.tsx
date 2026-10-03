import { useState } from "react";
import type { Criterion, CriterionResult } from "@clerk/shared";
import type { RunView } from "./api.js";
import { buildFeed, currentActivity } from "./feed.js";
import { Icon, plainCheck, useTech } from "./ui.js";

/** What Clerk did, in plain language. Technical mode adds the raw tool call under each line. */
export function Feed({ v, live }: { v: RunView; live: boolean }) {
  const { tech } = useTech();
  const entries = buildFeed(v).filter((e) => tech || e.kind !== "step" || !e.techOnly);
  if (!entries.length && !live) return <div className="empty">Nothing happened in the browser.</div>;
  return (
    <ol className="feed">
      {entries.map((e) => {
        if (e.kind === "system") return <li key={e.key} className="sys">In the {e.label}</li>;
        if (e.kind === "note") {
          return (
            <li key={e.key} className={`note ${e.tone}`}>
              <span>{e.text}</span>
              {e.detail && (tech || !/^[ri]\d/.test(e.key)) && <span className="small" style={{ opacity: .85 }}>{e.detail}</span>}
            </li>
          );
        }
        return (
          <li key={e.key} className={`item ${e.quiet ? "quiet" : ""} ${e.failed ? "failed" : ""}`}>
            <span className="ic"><i /></span>
            <span>
              <span className="txt">{e.text}</span>
              {e.detail && <span className="detail">{e.detail}</span>}
              {tech && e.actions.map((a) => (
                <div key={a.step} className="tech">
                  #{a.step} {a.tool}({Object.entries(a.args).map(([k, x]) => `${k}=${JSON.stringify(x)}`).join(", ")}) → {a.result}
                  {a.why && <><br />why: {a.why}</>}
                </div>
              ))}
            </span>
            {tech ? <span className="tag">{e.actions.map((a) => a.tag).filter((t, i, all) => all.indexOf(t) === i).join(" ")}</span> : <span />}
          </li>
        );
      })}
      {live && <li className="working"><span className="dot pulse" style={{ background: "currentColor" }} />{currentActivity(v)}…</li>}
    </ol>
  );
}

/** "Done means": the checks Clerk committed to before acting, ticked once the verifier has run. */
/** `stopped`: the run stopped on purpose, so the goal's checks were not expected to pass; show them neutrally. */
export function Checks({ criteria, results, open, stopped }: { criteria: Criterion[]; results?: CriterionResult[]; open?: boolean; stopped?: boolean }) {
  const { tech } = useTech();
  return (
    <ul className="checks">
      {criteria.map((c) => {
        const r = results?.find((x) => x.id === c.id);
        const mark = <span className={`mark ${r && !(stopped && !r.pass) ? (r.pass ? "pass" : "fail") : ""}`}>{r && !(stopped && !r.pass) ? (r.pass ? Icon.check() : Icon.cross()) : null}</span>;
        if (!r) return <li key={c.id}>{mark}<span>{plainCheck(c.check)}{tech && <span className="sub mono">{c.id} · {c.kind} · {c.source}</span>}</span></li>;
        return (
          <li key={c.id}>{mark}
            <details open={open ?? (tech || (!r.pass && !stopped))}>
              <summary>{plainCheck(c.check)}</summary>
              <div className="vs">
                <span>Expected</span><b>{plainCheck(r.expected)}</b>
                <span>Found in ERP</span><b>{r.found}</b>
                {tech && <><span>How checked</span><b>{r.how}</b></>}
                {r.note && <><span>Note</span><b>{r.note}</b></>}
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

export function ZoomImage({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <img src={src} alt={alt} onClick={() => setOpen(true)} />
      {open && <div className="zoom" role="dialog" aria-label={alt} onClick={() => setOpen(false)}><img src={src} alt={alt} /></div>}
    </>
  );
}
