// Agent API for the console. Same engine as the CLI; the approver and answerer here emit an event
// and wait for the human's decision to arrive over HTTP.
//   POST /api/runs                {request, chaos}      start a run
//   GET  /api/runs                                      recent runs (live + on disk)
//   GET  /api/runs/:id                                  state + what it is waiting for
//   GET  /api/runs/:id/events                           SSE: replay, then live
//   POST /api/runs/:id/approve    {id, approve, fields?, note?}
//   POST /api/runs/:id/answer     {id, answer}
//   POST /api/runs/:id/stop
//   GET  /api/runs/:id/files/*                          evidence (screenshots, downloads, summary.md)
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { streamSSE } from "hono/streaming";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import { z } from "zod";
import { ApprovalDecision, ChaosPreset, RunState, summarize, TERMINAL, type ApprovalRequest, type Question, type RunEvent } from "@clerk/shared";
import { config, REPO_ROOT, RUNS_DIR } from "./config.js";
import { llmConfigured, type LLM } from "./llm.js";
import { startRun, type Run } from "./run.js";
import { loadPlaybook } from "./skills.js";
import { traceUrl } from "./telemetry.js";

type Live = {
  run: Run;
  approvals: Map<string, { request: ApprovalRequest; resolve: (d: ApprovalDecision) => void }>;
  questions: Map<string, { question: Question; resolve: (a: string) => void }>;
};

/** `llm` is injectable for tests and offline demos; by default each run uses Gemini. */
export function createServer(opts: { llm?: LLM } = {}) {
  const live = new Map<string, Live>();
  const app = new Hono().basePath("/api");

  const readState = (id: string): RunState | undefined => {
    const l = live.get(id);
    if (l) return l.run.state;
    const p = join(RUNS_DIR, id, "state.json");
    return existsSync(p) ? RunState.parse(JSON.parse(readFileSync(p, "utf8"))) : undefined;
  };

  app.get("/health", async (c) => {
    const ping = async (path: string) => {
      try { return (await fetch(`${config.baseUrl}${path}`, { redirect: "manual", signal: AbortSignal.timeout(1500) })).status < 500; } catch { return false; }
    };
    return c.json({ portal: await ping("/portal/login"), erp: await ping("/erp/login"), model: config.model || null, modelReady: !!opts.llm || llmConfigured(), tracing: config.tracing, phoenixUrl: config.tracing ? config.phoenixUrl : null });
  });

  app.get("/playbook", (c) => c.json(loadPlaybook().map((s) => ({ name: s.name, description: s.description, appliesTo: s.appliesTo }))));

  app.post("/runs", async (c) => {
    const body = z.object({ request: z.string().min(3), chaos: ChaosPreset.default("off") }).parse(await c.req.json());
    const entry: Live = { approvals: new Map(), questions: new Map(), run: undefined as unknown as Run };
    entry.run = startRun({
      request: body.request,
      chaos: body.chaos,
      llm: opts.llm,
      approver: (request) => new Promise((res) => entry.approvals.set(request.id, { request, resolve: res })),
      answerer: (question) => new Promise((res) => entry.questions.set(question.id, { question, resolve: res })),
    });
    live.set(entry.run.id, entry);
    void entry.run.done.finally(() => setTimeout(() => live.delete(entry.run.id), 10 * 60_000));
    return c.json({ id: entry.run.id });
  });

  app.get("/runs", (c) => {
    const ids = new Set<string>(live.keys());
    if (existsSync(RUNS_DIR)) for (const d of readdirSync(RUNS_DIR)) if (/^run_\d+$/.test(d)) ids.add(d);
    const rows = [...ids].sort().reverse().slice(0, Number(c.req.query("limit") ?? 30))
      .map((id) => { try { const s = readState(id); return s ? summarize(s) : null; } catch { return null; } })
      .filter(Boolean);
    return c.json(rows);
  });

  app.get("/runs/:id", (c) => {
    const state = readState(c.req.param("id"));
    if (!state) return c.json({ error: "not found" }, 404);
    const l = live.get(state.id);
    return c.json({
      state,
      pendingApprovals: l ? [...l.approvals.values()].map((a) => a.request) : [],
      pendingQuestions: l ? [...l.questions.values()].map((q) => q.question) : [],
      traceUrl: traceUrl(state.traceId) ?? null,
      screenshots: (() => { const d = join(RUNS_DIR, state.id, "screenshots"); return existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".png")).sort() : []; })(),
    });
  });

  app.get("/runs/:id/events", (c) => {
    const id = c.req.param("id");
    const l = live.get(id);
    const file = join(RUNS_DIR, id, "events.jsonl");
    if (!l && !existsSync(file)) return c.json({ error: "not found" }, 404);
    return streamSSE(c, async (stream) => {
      const queue: RunEvent[] = [];
      let wake: (() => void) | undefined;
      const unsub = l?.run.bus.subscribe((e) => { queue.push(e); wake?.(); });
      const history: RunEvent[] = l ? [...l.run.bus.history] : readFileSync(file, "utf8").split("\n").filter(Boolean).map((x) => JSON.parse(x));
      const seen = history.at(-1)?.seq ?? 0;
      for (const e of history) await stream.writeSSE({ data: JSON.stringify(e), event: "run", id: String(e.seq) });
      let done = !l || TERMINAL.includes(l.run.state.status);
      stream.onAbort(() => { done = true; unsub?.(); wake?.(); });
      while (!done) {
        if (!queue.length) await new Promise<void>((r) => { wake = r; setTimeout(r, 15_000); });
        if (!queue.length) { await stream.writeSSE({ data: "", event: "ping" }); continue; }
        const e = queue.shift()!;
        if (e.seq <= seen) continue;
        await stream.writeSSE({ data: JSON.stringify(e), event: "run", id: String(e.seq) });
        if (e.type === "finished") done = true;
      }
      unsub?.();
    });
  });

  app.post("/runs/:id/approve", async (c) => {
    const l = live.get(c.req.param("id"));
    const body = ApprovalDecision.extend({ id: z.string() }).parse(await c.req.json());
    const pending = l?.approvals.get(body.id);
    if (!l || !pending) return c.json({ error: "no such pending approval" }, 404);
    l.approvals.delete(body.id);
    pending.resolve({ approve: body.approve, fields: body.fields, note: body.note });
    return c.json({ ok: true });
  });

  app.post("/runs/:id/answer", async (c) => {
    const l = live.get(c.req.param("id"));
    const body = z.object({ id: z.string(), answer: z.string() }).parse(await c.req.json());
    const pending = l?.questions.get(body.id);
    if (!l || !pending) return c.json({ error: "no such pending question" }, 404);
    l.questions.delete(body.id);
    pending.resolve(body.answer);
    return c.json({ ok: true });
  });

  app.post("/runs/:id/stop", (c) => {
    const l = live.get(c.req.param("id"));
    if (!l) return c.json({ error: "not running" }, 404);
    l.run.stop();
    for (const [k, a] of l.approvals) { a.resolve({ approve: false, note: "Run stopped by the user" }); l.approvals.delete(k); }
    for (const [k, q] of l.questions) { q.resolve("Stop. The user stopped the run."); l.questions.delete(k); }
    return c.json({ ok: true });
  });

  app.get("/runs/:id/files/*", (c) => {
    const id = c.req.param("id");
    const rel = decodeURIComponent(c.req.path.split(`/runs/${id}/files/`)[1] ?? "");
    const base = resolve(RUNS_DIR, id);
    const path = resolve(base, normalize(rel));
    if (!/^run_\d+$/.test(id) || !path.startsWith(base + "/") || !existsSync(path) || !statSync(path).isFile()) return c.notFound();
    const type = path.endsWith(".png") ? "image/png" : path.endsWith(".pdf") ? "application/pdf" : path.endsWith(".json") ? "application/json" : "text/plain; charset=utf-8";
    return c.body(readFileSync(path), 200, { "content-type": type });
  });

  app.get("/evals", (c) => {
    const read = (f: string) => (existsSync(join(REPO_ROOT, "evals", f)) ? JSON.parse(readFileSync(join(REPO_ROOT, "evals", f), "utf8")) : null);
    return c.json({ cases: read("cases.json") ?? [], results: read("results.json") });
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createServer();
  serve({ fetch: app.fetch, port: config.apiPort }, () => {
    console.log(`Clerk agent API on http://localhost:${config.apiPort}/api  (${config.provider}: ${config.model || "model not set"})`);
  });
}
