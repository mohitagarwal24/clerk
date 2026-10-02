// A test double for the model, behind the same LLM interface as Gemini. It reads the same
// stateless prompt the real model gets (refs from the current snapshot, last tool output) and
// answers with a fixed policy, so the loop, tools, gate, recovery and verifier run for real.
import type { LLM, ToolRequest, JsonRequest } from "../src/llm.js";

export type StepPolicy = (p: PromptView) => { name: string; args: Record<string, unknown> };

export class PromptView {
  constructor(readonly text: string) {}
  section(title: string): string {
    const i = this.text.indexOf(`# ${title}`);
    if (i < 0) return "";
    const rest = this.text.slice(i + title.length + 2);
    const j = rest.search(/\n# [A-Z]/);
    return j < 0 ? rest : rest.slice(0, j);
  }
  get obs() { return this.section("Current browser observation"); }
  get url() { return this.obs.match(/^\s*URL: (\S+)/m)?.[1] ?? ""; }
  get last() { return this.section("Result of your last action"); }
  get memory() { return this.section("Working memory"); }
  /** Ref of the first snapshot line matching a pattern. */
  ref(pattern: string): string {
    const m = this.obs.match(new RegExp(`${pattern}[^\\n]*\\[ref=([a-z0-9]+)\\]`));
    if (!m) throw new Error(`scripted LLM: no element matching /${pattern}/ on ${this.url}\n${this.obs}`);
    return m[m.length - 1]!;
  }
  has(pattern: string) { return new RegExp(pattern).test(this.obs); }
}

export const call = (name: string, args: Record<string, unknown> = {}) => ({ name, args: { why: `scripted: ${name}`, ...args } });

export function scriptedLLM(opts: { step: StepPolicy; json: (req: JsonRequest) => unknown }): LLM & { prompts: string[] } {
  const prompts: string[] = [];
  const usage = { model: "scripted", inputTokens: 1000, outputTokens: 50 };
  return {
    prompts,
    async callTool(req: ToolRequest) {
      prompts.push(req.prompt);
      return { ...opts.step(new PromptView(req.prompt)), usage };
    },
    async json(req: JsonRequest) {
      return { value: opts.json(req), usage };
    },
  };
}

/** The verifier's source re-check, done the way a careful reader would: skip superseded documents. */
export function readInvoiceDocs(prompt: string) {
  const docs = [...prompt.matchAll(/\[D\d+\] (\S+)\n<untrusted[^>]*>\n([\s\S]*?)\n<\/untrusted>/g)].map((m) => ({ path: m[1]!, text: m[2]! }));
  const valid = docs.filter((d) => /Total payable/.test(d.text)).find((d) => {
    const detail = docs.find((x) => x.path === `/portal/invoices/${d.text.match(/Invoice No\. (\S+)/)?.[1]}`);
    return !detail || !/Superseded/.test(detail.text);
  });
  if (!valid) return { ok: false, document: "none", values: [], note: "no valid invoice document" };
  const get = (re: RegExp) => valid.text.match(re)?.[1] ?? "";
  return {
    ok: true,
    document: valid.path,
    values: [
      { key: "invoice_no", value: get(/Invoice No\. (\S+)/) },
      { key: "amount", value: get(/Total payable \(INR\) ([\d,.]+)/) },
      { key: "due_date", value: get(/Payment Due (\S+)/) },
    ],
    note: "read from the invoice PDF",
  };
}
