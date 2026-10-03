// The engine entry point used by the CLI, the API server, the MCP server and evals:
//   UNDERSTANDING -> EXECUTING <-> (AWAITING_APPROVAL | AWAITING_USER | RECOVERING) -> VERIFYING -> DONE | NEEDS_ATTENTION | FAILED
// Front doors differ only in the approver and answerer they inject.
import type { ApprovalDecision, ChaosPreset, Question, Recovery, RunState, RunStatus } from "@clerk/shared";
import { config } from "./config.js";
import { BrowserSession, launchBrowser, runHeaders } from "./browser.js";
import { EventBus } from "./events.js";
import { ApprovalGate, type Approver } from "./gate.js";
import { findInjections } from "./injection.js";
import { costUsd, createLLM, type LLM, type Meter } from "./llm.js";
import { runLoop } from "./loop.js";
import { newRunId, newState, runDir, saveState } from "./memory.js";
import { writeReport } from "./reporter.js";
import { loadPlaybook } from "./skills.js";
import { currentTraceId, initTelemetry, span } from "./telemetry.js";
import { pickSkills, replan, understand } from "./understand.js";
import { verify } from "./verifier.js";

export type Answerer = (q: Question) => Promise<string>;

export type RunOptions = {
  request: string;
  chaos?: ChaosPreset;
  approver: Approver;
  answerer: Answerer;
  llm?: LLM;
  maxSteps?: number;
  id?: string;
};

export type Run = {
  id: string;
  state: RunState;
  bus: EventBus;
  done: Promise<RunState>;
  stop: () => void;
};

export function startRun(opts: RunOptions): Run {
  const id = opts.id ?? newRunId();
  const dir = runDir(id);
  const state = newState(id, opts.request, opts.chaos ?? "off", opts.maxSteps ?? config.maxSteps);
  const bus = new EventBus(id, dir);
  const abort = new AbortController();
  saveState(state);
  // Start on the next tick so callers can subscribe before the first event.
  const done = new Promise<void>((r) => setImmediate(r)).then(() => execute(opts, state, bus, dir, abort.signal));
  return { id, state, bus, done, stop: () => abort.abort() };
}

async function execute(opts: RunOptions, state: RunState, bus: EventBus, dir: string, signal: AbortSignal): Promise<RunState> {
  const emit = bus.emit;
  const setStatus = (status: RunStatus, note?: string) => {
    if (state.status === status) return;
    state.status = status;
    emit({ type: "status", status, note });
    saveState(state);
  };
  const meter: Meter = (u) => {
    state.usage.calls++;
    state.usage.inputTokens += u.inputTokens;
    state.usage.outputTokens += u.outputTokens;
    state.usage.costUsd = costUsd(state.usage);
    emit({ type: "usage", usage: { ...state.usage } });
  };
  const recover = (r: Recovery) => {
    state.recoveries.push(r);
    emit({ type: "recovery", recovery: r });
  };
  const flagInjections = (where: string, text: string) => {
    const hits = findInjections(text).filter((t) => !state.injectionFlags.some((f) => f.text === t));
    for (const t of hits) {
      state.injectionFlags.push({ step: state.step, where, text: t });
      emit({ type: "injection_flag", step: state.step, where, text: t });
    }
    return hits;
  };
  const approver: Approver = async (req) => {
    emit({ type: "approval_requested", request: req });
    setStatus("AWAITING_APPROVAL");
    const decision: ApprovalDecision = await opts.approver(req);
    emit({ type: "approval_resolved", id: req.id, decision });
    setStatus("EXECUTING");
    return decision;
  };
  const ask = async (q: Omit<Question, "id" | "step">) => {
    const question: Question = { ...q, id: `q-${state.questions.length + 1}`, step: state.step };
    state.questions.push({ ...question });
    emit({ type: "question", question });
    setStatus("AWAITING_USER");
    const answer = await opts.answerer(question);
    state.questions[state.questions.length - 1]!.answer = answer;
    emit({ type: "answered", id: question.id, answer });
    setStatus("EXECUTING");
    return answer;
  };
  const finishRun = (status: RunStatus, summary: string, stopReason?: string) => {
    state.status = status;
    state.stopReason = stopReason;
    state.endedAt = new Date().toISOString();
    writeReport(state, dir);
    emit({ type: "status", status });
    emit({ type: "finished", status, summary, stopReason });
    return state;
  };

  await initTelemetry();
  emit({ type: "run_started", request: state.request, chaos: state.chaos, maxSteps: state.maxSteps });

  return span("run", "AGENT", { "run.id": state.id, "input.value": state.request, chaos: state.chaos }, async (s) => {
    state.traceId = currentTraceId();
    let llm: LLM;
    try {
      llm = opts.llm ?? createLLM();
    } catch (e) {
      emit({ type: "error", message: (e as Error).message });
      return finishRun("FAILED", (e as Error).message, (e as Error).message);
    }
    const skills = loadPlaybook();
    const browser = await launchBrowser();
    try {
      // Understand + plan.
      const chosen = await pickSkills(llm, meter, state.request, skills);
      state.goal = await understand(llm, meter, state.request, skills, chosen);
      state.skillsLoaded = chosen;
      state.planRevision = 1;
      emit({ type: "goal", goal: state.goal, revision: 1, skills: chosen });
      for (const name of chosen) emit({ type: "skill_loaded", name });
      saveState(state);

      // Execute.
      const session = await BrowserSession.open(browser, runHeaders(state.id, state.chaos));
      const gate = new ApprovalGate({ approver, step: () => state.step });
      await gate.install(session.context);
      state.approvals = gate.records;
      setStatus("EXECUTING");

      const loopDeps = {
        llm, meter, state, session, gate, skills, dir, emit, signal,
        tools: {
          ask, recover, flagInjections,
          replan: async (reason: string) => {
            const plan = await replan(llm, meter, state, skills, reason);
            state.goal = { ...state.goal!, plan };
            state.planRevision++;
            state.planDone = 0;
            emit({ type: "goal", goal: state.goal, revision: state.planRevision, skills: state.skillsLoaded });
            return `plan revised (revision ${state.planRevision}, ${plan.length} steps)`;
          },
        },
      };

      let result = await runLoop(loopDeps, state.maxSteps);
      for (let attempt = 1; ; attempt++) {
        if (result.kind === "stopped") {
          await session.close();
          return finishRun(result.status, result.reason, result.reason);
        }
        state.finish = result.finish;
        setStatus("VERIFYING");
        try {
          state.verification = await verify({ llm, meter, browser, state, skills, dir, attempt, approvedWrites: gate.approvedWrites.length });
        } catch (e) {
          state.verification = { attempt, passed: false, criteria: [], source: { ok: false, values: {}, note: `verifier error: ${(e as Error).message}` } };
        }
        emit({ type: "verification", verification: state.verification });
        s.setAttribute("output.value", `${result.finish.outcome}; verified=${state.verification.passed}`);

        if (result.finish.outcome === "blocked") {
          await session.close();
          return finishRun("NEEDS_ATTENTION", result.finish.summary, firstSentence(result.finish.summary));
        }
        if (state.verification.passed) {
          await session.close();
          return finishRun("DONE", result.finish.summary);
        }
        if (attempt >= 2) {
          await session.close();
          return finishRun("NEEDS_ATTENTION", result.finish.summary, "Verification failed after one re-attempt");
        }
        // One re-attempt: tell the agent which checks failed (not the expected values' provenance).
        const failed = state.verification.criteria.filter((c) => !c.pass);
        state.facts.verification_failed = failed.map((c) => `${c.id} ${c.check}: expected ${c.expected}, found ${c.found}`).join(" | ") || "verifier could not confirm the result";
        emit({ type: "memory", facts: { ...state.facts } });
        setStatus("EXECUTING", "verification failed, re-attempting once");
        if (state.maxSteps - state.step < 10) state.maxSteps = state.step + 10;
        result = await runLoop(loopDeps, state.maxSteps - state.step);
      }
    } catch (e) {
      emit({ type: "error", message: (e as Error).message });
      return finishRun("FAILED", `Run failed: ${(e as Error).message}`, (e as Error).message);
    } finally {
      await browser.close().catch(() => {});
    }
  });
}

const firstSentence = (s: string) => s.split(/(?<=\.)\s/)[0] ?? s;
