// Working memory and run state. The state is the only thing that carries over between steps
// (prompts are stateless), and it is written to runs/<id>/state.json after every step.
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ChaosPreset, RunState } from "@clerk/shared";
import { RUNS_DIR } from "./config.js";

export const RECENT_LIMIT = 5;

export function newRunId(dir = RUNS_DIR): string {
  mkdirSync(dir, { recursive: true });
  const max = readdirSync(dir).map((d) => Number(d.match(/^run_(\d+)$/)?.[1] ?? 0)).reduce((a, b) => Math.max(a, b), 0);
  return `run_${String(max + 1).padStart(4, "0")}`;
}

export function newState(id: string, request: string, chaos: ChaosPreset, maxSteps: number): RunState {
  return {
    id, request, chaos, status: "UNDERSTANDING", step: 0, maxSteps, planRevision: 0, planDone: 0,
    skillsLoaded: [], facts: {}, recent: [], downloads: [], documents: [], approvals: [], questions: [], recoveries: [],
    injectionFlags: [], usage: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
    startedAt: new Date().toISOString(),
  };
}

export function remember(state: RunState, key: string, value: string) {
  state.facts[key.trim()] = value;
}

export function pushRecent(state: RunState, line: string) {
  state.recent.push(line);
  if (state.recent.length > RECENT_LIMIT) state.recent.splice(0, state.recent.length - RECENT_LIMIT);
}

export function runDir(id: string): string {
  return join(RUNS_DIR, id);
}

export function saveState(state: RunState) {
  const dir = runDir(state.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.json"), JSON.stringify(state, null, 2));
}
