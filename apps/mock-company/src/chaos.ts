// Replayable failure injection. Every trap is keyed to the run ID the agent sends in
// `x-clerk-run`, with the preset in `x-clerk-chaos`. Same run ID + preset => same traps,
// so a demo take can be replayed exactly after `pnpm reset`. No global counters.

export const PRESETS = ["off", "default", "rerun"] as const;
export type Preset = (typeof PRESETS)[number];

export type Traps = {
  /** The first N GETs of a portal invoice list in this run return 500. */
  invoiceList500: number;
  /** The new-bill form's "Save" button is replaced by "Create bill" shortly after load. */
  lateButtonSwap: boolean;
  /** ERP rejects ISO dates and drops the DD/MM/YYYY hint. */
  strictDates: boolean;
  /** INV-1042 already exists in the ERP before the agent starts. */
  preexistingBill: boolean;
};

const TRAPS: Record<Preset, Traps> = {
  off: { invoiceList500: 0, lateButtonSwap: false, strictDates: false, preexistingBill: false },
  default: { invoiceList500: 1, lateButtonSwap: true, strictDates: true, preexistingBill: false },
  rerun: { invoiceList500: 0, lateButtonSwap: false, strictDates: true, preexistingBill: true },
};

export const BUTTON_SWAP_DELAY_MS = 1200;

type RunChaos = { preset: Preset; counts: Map<string, number> };

export class ChaosState {
  private runs = new Map<string, RunChaos>();

  /** Resolve the chaos context for a request. Requests without a run ID (a human browsing) get no traps. */
  forRequest(runId: string | undefined, presetHeader: string | undefined): { runId: string | null; preset: Preset; traps: Traps } {
    if (!runId) return { runId: null, preset: "off", traps: TRAPS.off };
    let run = this.runs.get(runId);
    if (!run) {
      const preset = (PRESETS as readonly string[]).includes(presetHeader ?? "") ? (presetHeader as Preset) : "off";
      run = { preset, counts: new Map() };
      this.runs.set(runId, run);
    }
    return { runId, preset: run.preset, traps: TRAPS[run.preset] };
  }

  /** Count an event for a run and return how many times it has now happened (1-based). */
  hit(runId: string | null, key: string): number {
    if (!runId) return 0;
    const run = this.runs.get(runId);
    if (!run) return 0;
    const n = (run.counts.get(key) ?? 0) + 1;
    run.counts.set(key, n);
    return n;
  }

  reset() {
    this.runs.clear();
  }
}

export function trapsFor(preset: Preset): Traps {
  return TRAPS[preset];
}
