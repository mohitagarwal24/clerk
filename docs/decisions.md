# Decisions

Deviations from PRD.md and findings that changed the plan. Newest last.

## 2026-10-02 — Block 0 spike: Playwright AI snapshots
- Playwright 1.63.0. `locator('body').ariaSnapshot({ mode: 'ai' })` returns `[ref=…]` tags and `locator('aria-ref=<ref>')` clicks and fills by them. **No fallback needed.**
- Refs are not always `eN`: after a navigation they carry a frame prefix, e.g. `f2e23`. Parse refs as `[a-z0-9]+`, never `e\d+`.
- A ref from an older snapshot does not resolve after the DOM changes; the click simply times out. So the `click`/`type` tools need a short timeout (~2 s) and must classify a timeout on `aria-ref=` as **stale ref → re-snapshot** (PRD §6.4), not as a transient error.
- An icon button with a text glyph (⚙) still gets an accessible name. The vision-fallback trap (stretch) must use an SVG-only button with no label.

## 2026-10-02 — Block 1: mock company
- Chaos preset travels in a second header, `x-clerk-chaos` (`off` | `default` | `rerun`), next to `x-clerk-run`. A run keeps the preset it started with. Requests without `x-clerk-run` (a human browsing) never get traps. The agent's browser context sets both via `extraHTTPHeaders`; the verifier uses its own run ID with `off`.
- "Save relabelled Create bill" is implemented as a late re-render: 1.2 s after the new-bill form loads, the Save button is replaced by a new "Create bill" button. A ref taken from the first snapshot goes stale, which is the realistic version of this failure.
- ISO-date trap: INV-1042's PDF prints the due date as `2026-10-30`; with chaos on, the ERP drops the DD/MM/YYYY hint and rejects ISO dates.
- Superseded trap: INV-1041 was uploaded after INV-1042, so it sorts first, but it is marked Superseded.
- Amounts are only on the invoice PDF, not the portal pages, so `read_pdf` is required.
- Invoice PDFs are rendered on request (and also written to `apps/mock-company/invoices/` by `pnpm reset` for humans to open).
- `rerun` inserts INV-1042 into the ERP on the run's first ERP request. It stays until `pnpm reset`.
- Initech due dates are relative to the reset day, so "overdue" holds whenever the demo runs: 3 overdue open bills totalling ₹52,150.50; ₹57,750.50 total unpaid including one not yet due. The playbook must define which "outstanding" means.
- The verifier's read-only JSON is `GET /erp/api/bills?invoice_no=&vendor_id=&status=` (session login required; all writes return 405).

## 2026-10-02 — Blocks 2–9: engine, gate, verifier, console, evals, MCP
- **Zod 4's built-in `z.toJSONSchema`** replaces `zod-to-json-schema` (PRD §7). One fewer dependency; `llm.ts` strips `$schema`/`additionalProperties` before sending schemas to Gemini.
- **Understanding is two structured calls, not one**: (1) the model sees only the playbook index and picks skills, (2) GoalSpec from the request plus those skills' full text. Keeps progressive disclosure (FR2) while letting criteria be written with the relevant policy in view. The step loop can still `read_skill` later.
- **Criteria are a small check language the verifier runs in code**: `kind` = `record` (ERP rows match `where` + `expect_count`/`expect_fields`), `answer` (agent's reported value = `sum_amount`/`count` over rows), `no_writes` (gate log), `asked_user` (run log). Values the agent has not seen yet are written `$source.<key>`; only the verifier's source re-check fills them. No model output decides pass/fail.
- **Source re-check reads every cited source plus each document's parent page** (e.g. `/portal/invoices/INV-1042` for `/portal/invoices/INV-1042/pdf`), and is asked to reject a source that the company rules exclude. That is how it catches a superseded invoice without seeing the agent's reasoning.
- **Gate is installed with `context.route`, not `page.route`**: same mechanism, but it also covers pages the agent might open in a new tab. Only `/erp/login` and `/erp/logout` are exempt, by path. Approvals are single-use and bound to the exact body; a resubmission asks again and shows a diff against the last approved request. Human edits rewrite the held body; a rejection returns a 403 page the agent sees.
- **One tool per file** (AGENTS.md) instead of PRD §8's grouped files. Added `select` (ERP vendor dropdown) and `replan` (plan-mismatch row of §6.4). Every call carries `why` (for the log) and optional `plan_step` (for the plan panel).
- **`aria-ref` locators cannot be chained** (`locator('aria-ref=e2').locator('option')` matches nothing). `select` reads option labels with `evaluate` for its partial-match fallback.
- **Loop detection has a second rule**: the same visible page error after 6 consecutive actions stops the run. Found in testing: type → submit → same validation error with fresh refs each time never trips "same action 3×" and burns the whole step budget.
- **Injection flags are deterministic** (regex in `injection.ts`) and only report; the model's protection is the `<untrusted>` wrapping and the system rule.
- **Telemetry is opt-in** (`CLERK_TRACING=1`) so runs never depend on Phoenix. Spans carry OpenInference kinds (AGENT/LLM/TOOL/EVALUATOR) and GenAI token attributes.
- **Seed additions**: Initech `IN-5561` exists on the portal but not in the ERP (eval E1 needs a new invoice). `POST /__reset?reseed=1` reseeds a running server (evals use it between cases).
- **Eval cases adapted to the seed**: E8 marks `UOS-118` paid (the design's `B-2291` does not exist); E6 supplies an answer, so it must ask *and* then enter the right invoice. The simulated human approves every held write, so a policy violation by the agent shows up as a failed case.
- **"Outstanding" = all unpaid bills (Open + Escalated)** in `playbook/bill-status.md`: ₹57,750.50 for Initech at seed.
- **Testing without a model key**: `test/scripted-llm.ts` is a test double behind the same `LLM` interface. The e2e test runs real Chromium, the real mock apps with chaos, the gate and the verifier; only the model's choices are scripted. `pnpm offline` reuses it to click through the console.
- **Not built**: Gemini computer-use vision fallback (stretch).

## 2026-10-03 — Free model provider: NVIDIA build.nvidia.com
- **Default provider is now any OpenAI-compatible API, pointed at NVIDIA's free endpoint** (`integrate.api.nvidia.com/v1`, ~40 requests/min, no card). Gemini's free tier gives the newest Flash models only ~20 requests/day, and a run needs 25–30 calls. Gemini stays available with `LLM_PROVIDER=gemini`.
- `llm.ts` keeps the interface, validation and metering; providers live in `providers/gemini.ts` and `providers/openai.ts`. The OpenAI adapter uses plain `fetch` (no new dependency), so Cerebras, Groq, OpenRouter and Ollama work by changing `.env`.
- **Structured output is a forced call to a single `submit` tool** rather than a JSON mode, because tool calling is the most widely supported feature across hosted open models. If a server rejects forced `tool_choice`, the adapter falls back to `auto` for that model and parses JSON from the text; `decide`/`structured` still re-prompt once on malformed output.
- **Client-side pacing** (`LLM_RPM`, default 35) and 429/5xx retries honouring `Retry-After`, because free tiers rate-limit per account.
- `pnpm spike:llm` grades candidate models on a real planning call and a real step (the Globex list: must open INV-1042, not superseded INV-1041) before one is pinned.
