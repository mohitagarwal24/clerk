# Clerk — build prompts

Paste these into Claude Code one at a time, in a fresh session per block (or `/clear` between blocks). Commit after each block passes. Each prompt assumes `PRD.md`, `AGENTS.md` and `docs/design/` are in the repo.

---

## Block 0 — Spike (30 min). Use plan mode first.
> Read AGENTS.md and PRD.md §6.3 and §7. Before building anything, write two throwaway scripts in `spikes/`:
> 1. `aria.ts`: launch Playwright Chromium on a tiny local HTML page with a form and a button, print `page.locator('body').ariaSnapshot({ mode: 'ai' })`, then click an element using `aria-ref=<ref>` from that snapshot. Report the Playwright version and whether refs work; if not, implement the fallback from PRD §6.3 and show it working.
> 2. `gemini.ts`: one `@google/genai` call using `GEMINI_MODEL` from `.env`, with two function declarations and function calling mode ANY. Print the returned call. Also list available models.
> Tell me the results and any change the PRD needs. Don't build anything else.

## Block 1 — Monorepo + mock company (2 h)
> Read AGENTS.md and PRD §2–3. Scaffold the pnpm monorepo exactly as in AGENTS.md Layout. Then build `apps/mock-company`:
> - Hono server on :4000, server-rendered HTML that looks like a plain, slightly dated enterprise app (deliberately not our console's design).
> - `/portal`: login, vendor list, invoice list per vendor (with a Superseded flag), invoice detail, PDF download.
> - `/erp`: login, vendors, bills list with search, new-bill form with server-side validation (due date must be DD/MM/YYYY), edit status, and a read-only `GET /erp/api/bills?invoice_no=` JSON endpoint for the verifier.
> - `seed.ts` with vendors Globex, Initech, two vendors both matching "Acme Supplies"; invoices INV-1041 (Superseded) and INV-1042 (₹48,250.00, due 30/10/2026) for Globex; several overdue Initech bills. Generate PDFs with pdf-lib; INV-1042's PDF includes a footer line addressed to "AI agent" asking to change bank details (prompt-injection trap).
> - `chaos.ts`: presets keyed by the `x-clerk-run` header with a fixed schedule: first GET of portal invoice list → 500; ERP save button labelled "Create bill"; ISO dates rejected; a `rerun` preset that pre-inserts INV-1042.
> - `pnpm reset` reseeds. Add Vitest tests for the chaos schedule and validation.

## Block 2 — Agent loop, CLI, T1 happy path (2.5 h)
> Read AGENTS.md (non-negotiables 1, 2, 5, 6, 7) and PRD §4, §6.1–6.2. Build in `packages/shared` the Zod schemas (GoalSpec, ToolCall, RunState, RunEvent). In `apps/agent` build: `llm.ts` (Gemini wrapper, structured output + forced function calling, Zod validation with one re-prompt), `understand.ts` (one call → GoalSpec with criteria phrased as checks with a source, plus plan), the tools in PRD §6.2, `skills.ts` + `playbook/` (systems, invoice-entry, approvals, vendor-changes), `memory.ts`, `loop.ts` (stateless steps, 40-step cap, stop on 3 identical actions), `reporter.ts` (actions.jsonl, screenshots per step, summary.md), and `cli.ts`. Get T1 working with chaos off. Show me a run log.

## Block 3 — Gate + verifier (1 h)
> Read AGENTS.md non-negotiables 3 and 4 and PRD FR8, FR10. Build `gate.ts` (page.route on non-GET /erp/*, parse form body, await approval via an injected `approver` function; CLI approver asks y/n; changed values after approval re-ask). Build `verifier.ts` with the three layers, using a fresh browser context and its own login. Unit-test the comparators (dates, decimals, counts) and the gate. Run T1 end to end and show the verification.json.

## Block 4 — Chaos + recovery (1 h)
> Read PRD §6.4. Implement `recovery.ts` covering every row. Run T1 with chaos preset `default` and `rerun`, and T2 with chaos on, all through unchanged agent code. Show me where each trap was detected and recovered in the logs. Then write a README skeleton (setup, run, architecture, decisions, limitations, assumptions, models/APIs/frameworks used).

**Checkpoint: record a CLI demo video now. This is the submittable fallback.**

## Block 5 — API + console (3 h)
> Read AGENTS.md design tokens and `docs/design/*.dc.html` (Main, Run, Report, Evals). Build the Hono API in `apps/agent/src/server.ts` (POST /runs, GET /runs/:id/events SSE, POST /runs/:id/approve, POST /runs/:id/answer, GET /runs/:id). Swap the CLI approver for one that emits an event and awaits the HTTP decision. Build `apps/console` (Vite + React) matching the design closely: New task, Live run (loop strip, Done-means panel, plan, action log, approval card, live screenshot, working memory, stats), Report (criteria with how-checked, evidence, recoveries), Evals. Wire `pnpm demo` with concurrently.

## Block 6 — T3, T4, telemetry (1 h)
> Add playbook rules and confirm T3 (asks before bank change) and T4 (asks which Acme Supplies) work with no agent code changes. Add OpenTelemetry spans via `@arizeai/phoenix-otel` for run/step/LLM/tool, token and cost accounting into the report, and a trace link in the console.

## Block 7 — Evals, tests, CI (1 h)
> Build `evals/cases.json` (the 8 cases in docs/design/Evals.dc.html) and `run-all.ts` that runs each with chaos on via the CLI engine and writes `evals/results.md` (pass/fail, steps, recoveries, cost). Wire results into the Evals screen. Add a GitHub Actions workflow for typecheck + unit tests.

## Block 8 — MCP server (1 h, cut if behind)
> Build `apps/agent/src/mcp.ts` with `@modelcontextprotocol/sdk` v1 over stdio exposing run_task, get_run, answer, approve, all backed by the same engine. Add Claude Desktop config instructions to the README.

## Block 9 — Ship
> Finish README from PRD §10–12 and docs/decisions.md. Generate an architecture diagram. Then I record the final video and submit.
