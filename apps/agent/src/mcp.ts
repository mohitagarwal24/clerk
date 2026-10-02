// Clerk as an MCP server (stdio), so another agent (Claude Desktop, Cursor) can delegate a task
// and act as the human: it approves held ERP writes and answers questions. Same engine as the CLI.
//   run_task(request, chaos?)  ->  get_run(run_id) until done  ->  approve / answer when asked
// stdout carries JSON-RPC only; nothing in the engine prints to stdout.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ChaosPreset, TERMINAL, type ApprovalDecision, type ApprovalRequest, type Question } from "@clerk/shared";
import { startRun, type Run } from "./run.js";

type Live = {
  run: Run;
  approvals: Map<string, { request: ApprovalRequest; resolve: (d: ApprovalDecision) => void }>;
  questions: Map<string, { question: Question; resolve: (a: string) => void }>;
  changed: () => Promise<void>;
};

const runs = new Map<string, Live>();

function start(request: string, chaos: ChaosPreset): Live {
  const waiters = new Set<() => void>();
  const notify = () => { for (const w of waiters) w(); waiters.clear(); };
  const entry: Live = {
    approvals: new Map(), questions: new Map(), run: undefined as unknown as Run,
    changed: () => new Promise<void>((r) => waiters.add(r)),
  };
  entry.run = startRun({
    request, chaos,
    approver: (req) => new Promise((resolve) => { entry.approvals.set(req.id, { request: req, resolve }); notify(); }),
    answerer: (q) => new Promise((resolve) => { entry.questions.set(q.id, { question: q, resolve }); notify(); }),
  });
  void entry.run.done.then(() => notify());
  runs.set(entry.run.id, entry);
  return entry;
}

/** Wait until the run needs the caller or has finished (or the timeout passes). */
async function settle(l: Live, seconds: number) {
  const needsCaller = () => l.approvals.size > 0 || l.questions.size > 0 || TERMINAL.includes(l.run.state.status);
  const deadline = Date.now() + seconds * 1000;
  while (!needsCaller() && Date.now() < deadline) {
    await Promise.race([l.changed(), new Promise((r) => setTimeout(r, Math.min(2000, deadline - Date.now())))]);
  }
}

function report(l: Live): string {
  const s = l.run.state;
  const lines = [`run ${s.id} · ${s.status} · step ${s.step}/${s.maxSteps} · chaos ${s.chaos}`, `request: ${s.request}`];
  if (s.goal) lines.push("done means:", ...s.goal.success_criteria.map((c) => `  ${c.id} ${c.check}`));
  if (s.recent.length) lines.push("recent actions:", ...s.recent.map((r) => `  ${r}`));
  for (const { request: a } of l.approvals.values()) {
    lines.push(`WAITING FOR APPROVAL ${a.id}: ${a.method} ${a.path}`, ...a.fields.map((f) => `  ${f.name} = ${f.value}`));
    if (a.previous) lines.push(`  (re-approval; previously approved: ${a.previous.map((f) => `${f.name}=${f.value}`).join(", ")})`);
    lines.push(`  -> call approve(run_id="${s.id}", approval_id="${a.id}", approve=true|false)`);
  }
  for (const { question: q } of l.questions.values()) {
    lines.push(`WAITING FOR AN ANSWER ${q.id}: ${q.question}${q.options?.length ? ` Options: ${q.options.join(" | ")}` : ""}`,
      `  -> call answer(run_id="${s.id}", question_id="${q.id}", answer="...")`);
  }
  if (s.verification) lines.push(`verification: ${s.verification.passed ? "PASSED" : "FAILED"}`, ...s.verification.criteria.map((c) => `  ${c.pass ? "PASS" : "FAIL"} ${c.id} ${c.check}: expected ${c.expected}, found ${c.found}`));
  if (s.injectionFlags.length) lines.push(`prompt-injection attempts flagged and ignored: ${s.injectionFlags.length}`);
  if (TERMINAL.includes(s.status)) lines.push(`summary: ${s.finish?.summary ?? s.stopReason ?? ""}`, `evidence: runs/${s.id}/summary.md`);
  else if (!l.approvals.size && !l.questions.size) lines.push(`still working; call get_run(run_id="${s.id}") again`);
  return lines.join("\n");
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const notFound = (id: string) => ({ ...text(`No active run ${id} in this server session.`), isError: true });

const server = new McpServer({ name: "clerk", version: "0.1.0" });

server.registerTool("run_task", {
  title: "Run a back-office task",
  description: "Start Clerk on a plain-English back-office request against Acme Corp's Vendor Portal and ERP. Every ERP write is held for your approval; Clerk may ask you questions. Returns when the run needs you, finishes, or after wait_seconds.",
  inputSchema: { request: z.string().min(3), chaos: ChaosPreset.optional().describe("Failure injection preset for demos: off | default | rerun"), wait_seconds: z.number().int().min(0).max(120).optional() },
}, async ({ request, chaos, wait_seconds }) => {
  const l = start(request, chaos ?? "off");
  await settle(l, wait_seconds ?? 60);
  return text(report(l));
});

server.registerTool("get_run", {
  title: "Get run status",
  description: "Status of a Clerk run: progress, what it is waiting for (approval or answer), verification and summary. Waits up to wait_seconds for the run to need you or finish.",
  inputSchema: { run_id: z.string(), wait_seconds: z.number().int().min(0).max(120).optional() },
}, async ({ run_id, wait_seconds }) => {
  const l = runs.get(run_id);
  if (!l) return notFound(run_id);
  await settle(l, wait_seconds ?? 30);
  return text(report(l));
});

server.registerTool("approve", {
  title: "Approve or reject a held ERP write",
  description: "Decide on an ERP write that Clerk's network gate is holding. Optionally correct field values.",
  inputSchema: { run_id: z.string(), approval_id: z.string(), approve: z.boolean(), note: z.string().optional(), fields: z.record(z.string(), z.string()).optional() },
}, async ({ run_id, approval_id, approve, note, fields }) => {
  const l = runs.get(run_id);
  const p = l?.approvals.get(approval_id);
  if (!l || !p) return notFound(`${run_id}/${approval_id}`);
  l.approvals.delete(approval_id);
  p.resolve({ approve, note, fields });
  await settle(l, 30);
  return text(report(l));
});

server.registerTool("answer", {
  title: "Answer Clerk's question",
  description: "Reply to a question Clerk asked (for example which of two vendors you meant).",
  inputSchema: { run_id: z.string(), question_id: z.string(), answer: z.string() },
}, async ({ run_id, question_id, answer }) => {
  const l = runs.get(run_id);
  const p = l?.questions.get(question_id);
  if (!l || !p) return notFound(`${run_id}/${question_id}`);
  l.questions.delete(question_id);
  p.resolve(answer);
  await settle(l, 30);
  return text(report(l));
});

await server.connect(new StdioServerTransport());
