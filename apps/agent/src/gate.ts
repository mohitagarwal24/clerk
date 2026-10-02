// The approval gate. It sits on the browser's network layer, not on any tool: every non-GET
// request to /erp/* is held until a human decides, whatever click or keypress caused it.
// The human sees the values parsed from the request body itself, not what the agent claims it typed.
// Approval is single-use and bound to the exact values sent; a resubmission asks again and shows
// what changed since the last approved request to the same endpoint.
import type { BrowserContext, Route } from "playwright";
import type { ApprovalDecision, ApprovalRecord, ApprovalRequest, FormField } from "@clerk/shared";

export type Approver = (req: ApprovalRequest) => Promise<ApprovalDecision>;

/** Authentication is not a business write; it is the only exemption, and it is by path, not by tool. */
const EXEMPT_PATHS = [/^\/erp\/login$/, /^\/erp\/logout$/];
const SECRET_FIELD = /pass(word)?|secret|token/i;

export function isGated(method: string, url: string): boolean {
  const { pathname } = new URL(url);
  if (!pathname.startsWith("/erp/") && pathname !== "/erp") return false;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
  return !EXEMPT_PATHS.some((re) => re.test(pathname));
}

/** Parse a request body into named fields (urlencoded, JSON or multipart). */
export function parseBody(body: string | null, contentType = ""): FormField[] {
  if (!body) return [];
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return [...new URLSearchParams(body)].map(([name, value]) => ({ name, value }));
  }
  if (contentType.includes("application/json")) {
    try {
      const obj = JSON.parse(body) as Record<string, unknown>;
      return Object.entries(obj).map(([name, v]) => ({ name, value: typeof v === "string" ? v : JSON.stringify(v) }));
    } catch { /* fall through to raw */ }
  }
  if (contentType.includes("multipart/form-data")) {
    const fields: FormField[] = [];
    for (const m of body.matchAll(/name="([^"]+)"\r?\n\r?\n([\s\S]*?)\r?\n--/g)) fields.push({ name: m[1]!, value: m[2]! });
    if (fields.length) return fields;
  }
  return [{ name: "body", value: body }];
}

export function redact(fields: FormField[]): FormField[] {
  return fields.map((f) => (SECRET_FIELD.test(f.name) ? { ...f, value: "••••••" } : f));
}

export function applyEdits(fields: FormField[], edits: Record<string, string> | undefined): FormField[] {
  if (!edits) return fields;
  const out = fields.map((f) => (f.name in edits ? { ...f, value: edits[f.name]! } : f));
  for (const [name, value] of Object.entries(edits)) if (!out.some((f) => f.name === name)) out.push({ name, value });
  return out;
}

export function changedFields(now: FormField[], before: FormField[] | undefined): string[] {
  if (!before) return [];
  const prev = new Map(before.map((f) => [f.name, f.value]));
  return now.filter((f) => prev.get(f.name) !== f.value).map((f) => f.name);
}

const rejectionPage = (note?: string) => `<!doctype html><title>Rejected</title>
<div role="alert"><h1>Request rejected by human approver</h1><p>${(note ?? "No reason given.").replace(/[<>&]/g, "")}</p>
<p>Nothing was saved. Do not resubmit the same values.</p></div>`;

export class ApprovalGate {
  readonly records: ApprovalRecord[] = [];
  private pending = new Set<Promise<unknown>>();
  private seq = 0;

  constructor(private opts: { approver: Approver; step: () => number; idPrefix?: string }) {}

  async install(context: BrowserContext) {
    await context.route((url) => url.pathname.startsWith("/erp"), (route) => this.handle(route));
  }

  /** Resolves once no write is waiting for a decision. The loop waits on this before observing. */
  async idle() {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }

  get approvedWrites(): ApprovalRecord[] {
    return this.records.filter((r) => r.decision?.approve);
  }

  private async handle(route: Route) {
    const req = route.request();
    if (!isGated(req.method(), req.url())) return route.continue();

    const work = (async () => {
      const contentType = req.headers()["content-type"] ?? "";
      const fields = parseBody(req.postData(), contentType);
      const path = new URL(req.url()).pathname;
      const previous = [...this.records].reverse().find((r) => r.path === path && r.decision?.approve)?.sent;
      const request: ApprovalRequest = {
        id: `${this.opts.idPrefix ?? "ap"}-${++this.seq}`, step: this.opts.step(), method: req.method(), path,
        fields: redact(fields), previous: previous ? redact(previous) : undefined,
      };
      const record: ApprovalRecord = { ...request };
      this.records.push(record);

      let decision: ApprovalDecision;
      try {
        decision = await this.opts.approver(request);
      } catch (e) {
        decision = { approve: false, note: `Approval failed: ${(e as Error).message}` };
      }
      record.decision = decision;
      if (!decision.approve) {
        return route.fulfill({ status: 403, contentType: "text/html", body: rejectionPage(decision.note) });
      }
      const sent = applyEdits(fields, decision.fields);
      record.sent = sent;
      if (!decision.fields) return route.continue();
      // The human edited values: send exactly what they approved.
      const body = new URLSearchParams(sent.map((f) => [f.name, f.value])).toString();
      return route.continue({ postData: body, headers: { ...req.headers(), "content-type": "application/x-www-form-urlencoded" } });
    })();
    this.pending.add(work);
    try { await work; } finally { this.pending.delete(work); }
  }
}
