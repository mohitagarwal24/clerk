// Single source of truth for the shapes that cross a boundary: the model's structured output,
// run state on disk, and the events the console, CLI and MCP server all consume.
import { z } from "zod";

// ---- Goal understanding ---------------------------------------------------

/** A filter on rows of the ERP's read-only JSON. `~` is case-insensitive "contains". */
export const Where = z.object({
  field: z.string().describe("Row field, e.g. invoice_no, vendor_name, vendor_id, status, overdue, name"),
  op: z.enum(["=", "!=", "~"]),
  value: z.string().describe('Literal, or "$source.<key>" to use the value the verifier re-reads from the source document'),
});
export type Where = z.infer<typeof Where>;

export const FieldExpectation = z.object({
  field: z.string(),
  value: z.string().describe('Literal, or "$source.<key>"'),
});

/**
 * A success criterion is a check with a declared source, never a value the agent has yet to find.
 * The verifier evaluates `kind` in code; the model only writes the check.
 */
export const Criterion = z.object({
  id: z.string().describe("C1, C2, ..."),
  check: z.string().describe("Human-readable check, e.g. 'Bill amount equals the total on the selected invoice PDF'"),
  source: z.string().describe("Where the expected value comes from, e.g. 'invoice PDF', 'ERP record', 'request', 'playbook'"),
  kind: z.enum(["record", "answer", "no_writes", "asked_user"]).describe(
    "record: rows in the ERP match; answer: a value the agent reports equals an aggregate computed from ERP rows; " +
      "no_writes: no ERP write went through; asked_user: the agent asked a human before acting",
  ),
  resource: z.enum(["bills", "vendors"]).optional().describe("ERP resource for record/answer checks"),
  where: z.array(Where).optional().describe("Row filter for record/answer checks (all must hold)"),
  expect_count: z.string().optional().describe('Number of matching rows, e.g. "1" or ">=1"'),
  expect_fields: z.array(FieldExpectation).optional().describe("Every matching row must have these field values"),
  answer_key: z.string().optional().describe("For kind=answer: the key the agent must report in finish.answers"),
  aggregate: z.enum(["sum_amount", "count"]).optional().describe("For kind=answer: what to compute over matching rows"),
});
export type Criterion = z.infer<typeof Criterion>;

export const GoalSpec = z.object({
  intent: z.string().describe("One sentence: what done looks like"),
  entities: z.array(z.object({ name: z.string(), value: z.string() })).describe("Named things from the request (vendor, action, ...)"),
  source_fields: z
    .array(z.object({ key: z.string(), description: z.string() }))
    .describe("Values the verifier must independently re-read from the source document (empty if no source document)"),
  success_criteria: z.array(Criterion),
  open_questions: z.array(z.string()).describe("Ambiguities the playbook cannot resolve; the agent will ask the user"),
  plan: z.array(z.string()).describe("3-8 short steps"),
});
export type GoalSpec = z.infer<typeof GoalSpec>;

// ---- Runs -----------------------------------------------------------------

export const CHAOS_PRESETS = ["off", "default", "rerun"] as const;
export const ChaosPreset = z.enum(CHAOS_PRESETS);
export type ChaosPreset = z.infer<typeof ChaosPreset>;

export const RUN_STATUSES = [
  "UNDERSTANDING", "EXECUTING", "AWAITING_APPROVAL", "AWAITING_USER", "RECOVERING", "VERIFYING",
  "DONE", "NEEDS_ATTENTION", "FAILED",
] as const;
export const RunStatus = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof RunStatus>;
export const TERMINAL: readonly RunStatus[] = ["DONE", "NEEDS_ATTENTION", "FAILED"];

/** How an action log entry is labelled in the console. */
export const ActionTag = z.enum(["PLAN", "ACT", "DECIDE", "ADAPT", "RECOVER", "ASK", "VERIFY"]);
export type ActionTag = z.infer<typeof ActionTag>;

export const ActionRecord = z.object({
  step: z.number(),
  tool: z.string(),
  args: z.record(z.string(), z.unknown()),
  why: z.string(),
  tag: ActionTag,
  ok: z.boolean(),
  result: z.string(),
  url: z.string().optional(),
  screenshot: z.string().optional(),
  at: z.string(),
  ms: z.number(),
});
export type ActionRecord = z.infer<typeof ActionRecord>;

export const FormField = z.object({ name: z.string(), value: z.string() });
export type FormField = z.infer<typeof FormField>;

export const ApprovalRequest = z.object({
  id: z.string(),
  step: z.number(),
  method: z.string(),
  path: z.string(),
  fields: z.array(FormField),
  /** Fields of the last approved request to the same path, so the UI can show what changed. */
  previous: z.array(FormField).optional(),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequest>;

export const ApprovalDecision = z.object({
  approve: z.boolean(),
  /** Edited values. The gate rewrites the held request body with these. */
  fields: z.record(z.string(), z.string()).optional(),
  note: z.string().optional(),
});
export type ApprovalDecision = z.infer<typeof ApprovalDecision>;

export const ApprovalRecord = ApprovalRequest.extend({
  decision: ApprovalDecision.optional(),
  sent: z.array(FormField).optional(),
});
export type ApprovalRecord = z.infer<typeof ApprovalRecord>;

export const Question = z.object({ id: z.string(), step: z.number(), question: z.string(), options: z.array(z.string()).optional() });
export type Question = z.infer<typeof Question>;
export const QuestionRecord = Question.extend({ answer: z.string().optional() });
export type QuestionRecord = z.infer<typeof QuestionRecord>;

export const Recovery = z.object({ step: z.number(), kind: z.string(), detail: z.string() });
export type Recovery = z.infer<typeof Recovery>;

export const Usage = z.object({ calls: z.number(), inputTokens: z.number(), outputTokens: z.number(), costUsd: z.number() });
export type Usage = z.infer<typeof Usage>;

export const FinishArgs = z.object({
  outcome: z.enum(["completed", "blocked"]).describe("completed: the goal is done; blocked: you stopped on purpose (duplicate, policy, user said stop)"),
  summary: z.string().describe("2-4 sentences for the user: what you did, or why you stopped"),
  answers: z.array(z.object({ key: z.string(), value: z.string() })).describe("Values the request asked for, keyed as in the success criteria"),
  sources: z.array(z.string()).describe("URLs of the source pages/documents your result depends on"),
});
export type FinishArgs = z.infer<typeof FinishArgs>;

export const CriterionResult = z.object({
  id: z.string(),
  check: z.string(),
  how: z.string(),
  expected: z.string(),
  found: z.string(),
  pass: z.boolean(),
  note: z.string().optional(),
});
export type CriterionResult = z.infer<typeof CriterionResult>;

export const SourceRecheck = z.object({
  ok: z.boolean(),
  document: z.string().optional(),
  values: z.record(z.string(), z.string()),
  note: z.string(),
});
export type SourceRecheck = z.infer<typeof SourceRecheck>;

export const Verification = z.object({
  attempt: z.number(),
  passed: z.boolean(),
  criteria: z.array(CriterionResult),
  source: SourceRecheck.optional(),
  readback: z.object({ comment: z.string(), screenshot: z.string().optional() }).optional(),
});
export type Verification = z.infer<typeof Verification>;

export const RunState = z.object({
  id: z.string(),
  request: z.string(),
  chaos: ChaosPreset,
  status: RunStatus,
  step: z.number(),
  maxSteps: z.number(),
  goal: GoalSpec.optional(),
  planRevision: z.number(),
  planDone: z.number().describe("How many plan steps the agent has marked done"),
  skillsLoaded: z.array(z.string()),
  facts: z.record(z.string(), z.string()),
  recent: z.array(z.string()).describe("Last action summaries fed back into the prompt"),
  downloads: z.array(z.object({ url: z.string(), path: z.string(), name: z.string() })),
  approvals: z.array(ApprovalRecord),
  questions: z.array(QuestionRecord),
  recoveries: z.array(Recovery),
  injectionFlags: z.array(z.object({ step: z.number(), where: z.string(), text: z.string() })),
  usage: Usage,
  finish: FinishArgs.optional(),
  verification: Verification.optional(),
  stopReason: z.string().optional(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  traceId: z.string().optional(),
});
export type RunState = z.infer<typeof RunState>;

// ---- Events ---------------------------------------------------------------

type E<T extends string, P> = { type: T; runId: string; seq: number; at: string } & P;

export type RunEvent =
  | E<"run_started", { request: string; chaos: ChaosPreset; maxSteps: number }>
  | E<"status", { status: RunStatus; note?: string }>
  | E<"goal", { goal: GoalSpec; revision: number; skills: string[] }>
  | E<"skill_loaded", { name: string }>
  | E<"action", { action: ActionRecord }>
  | E<"observation", { step: number; url: string; title: string; screenshot?: string }>
  | E<"memory", { facts: Record<string, string> }>
  | E<"plan_progress", { done: number }>
  | E<"recovery", { recovery: Recovery }>
  | E<"approval_requested", { request: ApprovalRequest }>
  | E<"approval_resolved", { id: string; decision: ApprovalDecision }>
  | E<"question", { question: Question }>
  | E<"answered", { id: string; answer: string }>
  | E<"injection_flag", { step: number; where: string; text: string }>
  | E<"usage", { usage: Usage }>
  | E<"verification", { verification: Verification }>
  | E<"finished", { status: RunStatus; summary: string; stopReason?: string }>
  | E<"error", { message: string }>;

export type RunEventType = RunEvent["type"];

/** What the event emitter is given; seq/at/runId are stamped by the run. */
export type RunEventInput = RunEvent extends infer T ? (T extends RunEvent ? Omit<T, "runId" | "seq" | "at"> : never) : never;

/** A row in the runs list. */
export type RunSummary = {
  id: string; request: string; chaos: ChaosPreset; status: RunStatus; step: number; maxSteps: number;
  startedAt: string; endedAt?: string; verified?: string; stopReason?: string;
};

export function summarize(s: RunState): RunSummary {
  const v = s.verification;
  return {
    id: s.id, request: s.request, chaos: s.chaos, status: s.status, step: s.step, maxSteps: s.maxSteps,
    startedAt: s.startedAt, endedAt: s.endedAt, stopReason: s.stopReason,
    verified: v ? `${v.criteria.filter((c) => c.pass).length}/${v.criteria.length}` : undefined,
  };
}

// ---- Evals ----------------------------------------------------------------

export const EvalCase = z.object({
  id: z.string(),
  request: z.string(),
  tag: z.string(),
  chaos: ChaosPreset,
  expect: z.string().describe("Shown in the table"),
  /** Pass conditions, all must hold. */
  pass: z.object({
    status: z.array(RunStatus).optional(),
    verified: z.boolean().optional(),
    asked: z.boolean().optional(),
    no_writes: z.boolean().optional(),
    answer_contains: z.string().optional(),
    erp: z.array(z.object({ resource: z.enum(["bills", "vendors"]), where: z.array(Where), field: z.string(), value: z.string() })).optional(),
  }),
  /** What the simulated human says if asked. */
  answer: z.string().optional(),
});
export type EvalCase = z.infer<typeof EvalCase>;

export type EvalResult = {
  id: string; request: string; tag: string; expect: string; runId: string; status: RunStatus;
  pass: boolean; reasons: string[]; steps: number; recoveries: number; costUsd: number; ms: number;
};
