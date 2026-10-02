// One emit() per run. Console (SSE), CLI and MCP all consume the same events; every event is
// also appended to runs/<id>/events.jsonl so a finished run can be replayed.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { RunEvent, RunEventInput } from "@clerk/shared";

export type Listener = (e: RunEvent) => void;

export class EventBus {
  private seq = 0;
  private listeners = new Set<Listener>();
  readonly history: RunEvent[] = [];

  constructor(private runId: string, private dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  emit = (input: RunEventInput): RunEvent => {
    const e = { ...input, runId: this.runId, seq: ++this.seq, at: new Date().toISOString() } as RunEvent;
    this.history.push(e);
    appendFileSync(join(this.dir, "events.jsonl"), JSON.stringify(e) + "\n");
    for (const l of this.listeners) {
      try { l(e); } catch { /* a broken listener must not break the run */ }
    }
    return e;
  };

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

export type Emit = EventBus["emit"];
