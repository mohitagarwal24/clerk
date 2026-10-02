// Failure taxonomy -> strategy (PRD §6.4). Every row lives here so it can be read in one place:
//
//   transient (5xx/429/timeout on a GET)   -> reload with backoff, max 3          (handled in code)
//   stale or missing ref                    -> re-snapshot, model re-picks          (told to the model)
//   validation error after a write          -> model corrects input, gate re-asks  (told to the model)
//   plan mismatch                           -> model calls `replan`                 (replan call)
//   ambiguity                               -> model calls `ask_user`               (playbook rule)
//   duplicate / policy conflict             -> model calls finish(blocked)          (playbook rule)
//   loop (same action 3x, or the same page
//         error after 6 actions in a row)   -> stop, NEEDS_ATTENTION                (LoopGuard)
//   malformed model output                  -> one re-prompt, then stop             (llm.ts decide/structured)
//   budget exhausted                        -> stop at step cap, NEEDS_ATTENTION    (loop.ts)
import type { BrowserSession } from "./browser.js";

export type FailureKind = "stale_ref" | "transient" | "timeout" | "navigation" | "bad_input" | "unknown";

export type Failure = { kind: FailureKind; message: string };

export class ToolInputError extends Error {}

export function classify(e: unknown): Failure {
  const msg = (e as Error)?.message ?? String(e);
  const first = msg.split("\n")[0]!;
  if (e instanceof ToolInputError) return { kind: "bad_input", message: first };
  if (/aria-ref=/.test(msg) && /(Timeout|not found|waiting for)/i.test(msg)) {
    return { kind: "stale_ref", message: "That ref is not on the current page (it came from an older snapshot or the element was re-rendered). Pick a ref from the snapshot below." };
  }
  if (/ERR_CONNECTION|ECONNREFUSED|ERR_NAME|net::/i.test(msg)) return { kind: "transient", message: `Network error: ${first}` };
  if (/Timeout \d+ms exceeded/i.test(msg)) return { kind: "timeout", message: `Timed out: ${first}` };
  if (/navigat/i.test(msg)) return { kind: "navigation", message: first };
  return { kind: "unknown", message: first };
}

export const isTransientStatus = (s: number | undefined) => s !== undefined && (s >= 500 || s === 429);

/**
 * After an action: if the page we landed on is a transient server error from a GET, reload with
 * backoff (800 ms, 1.6 s, 3.2 s). Never auto-repeat a POST; the model sees that error instead.
 * Returns one line per retry for the action log.
 */
export async function retryTransient(session: BrowserSession, max = 3, baseMs = 800): Promise<string[]> {
  const notes: string[] = [];
  for (let attempt = 1; attempt <= max; attempt++) {
    if (!isTransientStatus(session.lastStatus) || session.lastMethod !== "GET") break;
    const failed = session.lastStatus;
    const wait = baseMs * 2 ** (attempt - 1);
    await session.page.waitForTimeout(wait);
    await session.page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    notes.push(`HTTP ${failed} · retry ${attempt}/${max} after ${wait} ms → HTTP ${session.lastStatus ?? "?"}`);
  }
  return notes;
}

/** Detects the agent going round in circles. */
export class LoopGuard {
  static readonly SAME_ACTION = 3;
  static readonly SAME_ERROR = 6;
  private last = "";
  private count = 0;
  private lastError = "";
  private errorCount = 0;

  /** Returns how many times in a row this exact action (tool + args, without `why`) has now been chosen. */
  see(name: string, args: Record<string, unknown>): number {
    const key = `${name}:${JSON.stringify(args)}`;
    this.count = key === this.last ? this.count + 1 : 1;
    this.last = key;
    return this.count;
  }

  /**
   * Returns how many actions in a row have ended on the same visible page error. Catches cycles
   * the same-action check cannot, e.g. type -> submit -> same validation error with fresh refs.
   */
  seeErrors(errors: string[]): number {
    const key = errors.join(" | ");
    if (!key) { this.lastError = ""; this.errorCount = 0; return 0; }
    this.errorCount = key === this.lastError ? this.errorCount + 1 : 1;
    this.lastError = key;
    return this.errorCount;
  }
}

/** What the model is told after a failure, so its next choice is informed. */
export function adviceFor(f: Failure): string {
  switch (f.kind) {
    case "stale_ref": return f.message;
    case "transient": return `${f.message}. The system may be briefly unavailable; try again or open the page again.`;
    case "timeout": return `${f.message}. The element may be hidden, disabled or gone; check the snapshot below.`;
    case "bad_input": return f.message;
    default: return `Action failed: ${f.message}`;
  }
}
