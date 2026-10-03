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
- **First live run (Nemotron 3 Super) taught two changes.** PDF text was shown to the model only on the next step, relying on it to `remember` values; it instead moved on, lost the text, and spent 30 steps re-reading the PDF and wandering until the 40-step cap. Now documents the agent reads are kept in `RunState.documents` and shown (untrusted, capped) in every step prompt, and re-reading returns a pointer. Repetition is also caught when not consecutive: the same action 3× in the last 10 steps adds a warning to the next prompt, 5× stops the run. Re-run: DONE, verified, 20 steps.
- **Pinned models**: agent `nvidia/nemotron-3-super-120b-a12b` (0.6 s for a tiny call, passes the spike), verifier `moonshotai/kimi-k3` (slower, best criteria in the spike; only 2 calls per run). DeepSeek V4.1 Flash and GLM 5.3 timed out on the free endpoint at the time of testing; Kimi K2.6 and Mistral Large 2 returned 404 for this account.

## 2026-10-03 — Console redesign for the person who asked for the work
- Audit: the first console exposed the engine (tool calls with refs, ACT/ADAPT tags, an 8-stage loop strip with counters, tokens, run IDs, "record · ERP record" criteria kinds, skill filenames, a model ID next to the request box) and used monospace for labels. Useful to an engineer, noise to an accounts-payable user.
- Now two layers. Default: plain-language activity feed (`feed.ts` turns actions into sentences, merges form filling, hides bookkeeping, inserts recoveries, injection flags and your decisions where they happened), a 4-phase progress bar, a large live view, "Done means" as a checklist, and a report that leads with the outcome and the result. A "Technical details" switch reveals everything that was removed, so an engineer or interviewer loses nothing.
- Approval sheet shows human labels and the vendor's name ("Globex Corporation (Mumbai)") instead of `vendor_id: V-001`, via `GET /api/lookup/vendors` (server-side ERP read; credentials stay on the server). Re-approvals name the fields that changed. Reject asks for a reason inline instead of a browser prompt.
- Playbook skills gained an optional `rule:` line written for people; the model still uses `description`.
- Plan progress never marks the last step done while the run is still going (the model sometimes reports a final plan step early).

## 2026-10-03 — Model retired mid-project; automatic model fallback
- NVIDIA retired `nvidia/nemotron-3-super-120b-a12b` on 2026-10-03 09:00 UTC (HTTP 410 "end of life"), and Kimi K3 was timing out under load the same morning. Free hosted models can disappear or stall without notice, which would break a live demo.
- The OpenAI-compatible provider now walks a fallback chain (`LLM_FALLBACK_MODELS`): on 404/410 ("model gone") or no response within `LLM_TIMEOUT_MS` (default 90 s, one retry), it moves to the next model and stays there for the process. The switch is logged to stderr (stdout stays clean for MCP) and the model actually used is recorded in usage.
- Re-graded with `pnpm spike:llm`: agent model is now `openai/gpt-oss-20b` (2.8 s for a forced tool call; criteria included count, amount, due date and status; opened INV-1042).
- Verifier uses the same model (`LLM_VERIFIER_MODEL` empty). Its independence comes from a fresh browser context and never seeing the agent's notes, not from a different model. Nemotron 3.5 Lightning, tried as verifier, wrote wrong criteria (matched vendor name against `$source.invoice_no`) and took 228 s, so it is only the last fallback. Fallback order: Kimi K3 (best quality when responsive), then Nemotron 3.5 Lightning.

## 2026-10-03 — First full eval run (5/8) and what it changed
First run on frozen code with `openai/gpt-oss-20b` (kept in `evals/results-run1.md`). Three failures, three generic fixes, then all eight cases re-run (not just the failures):
- **E6, ambiguous vendor ("Acme Supplies")**: the agent saw both matching vendors and picked one. The "ask instead of guessing" rule existed in the playbook, but only as a planning-time rule. Now the step prompt says: when more than one record plausibly matches what the user named, ask with each candidate as an option unless a company rule decides; `invoice-entry.md` says the same at the "find the vendor" step.
- **E3, read-only total**: the planner invented an ambiguity ("confirm the vendor name is exactly Initech"), asked, and stopped. The criteria guide and the `open_questions` schema now say open questions are only for ambiguity visible in the request, and never to confirm what the user already said.
- **E1, new Initech invoice**: the bill was created correctly but verification failed for two reasons. (1) The planner wrote `vendor_name = "Initech"` while the record says "Initech LLC"; the guide now says names are matched with `~`, and `lintGoal()` deterministically rewrites a literal `=` on name fields to `~`. (2) The agent cited the ERP page it created as its source, and the source re-check called it a "duplicate". `finish` now asks for the source-system page and document, and the verifier is told that ERP records are not its concern when judging the source. Also seen: the agent pressed Enter in a form field, submitting a half-filled bill (the gate held it and the ERP rejected it); the `type` tool and step prompt now say `submit=true` is for search boxes only.

## 2026-10-03 — Second eval run (5/8): the agent was right, the plumbing wasn't
After the first fixes, E6 (ambiguous vendor) passed: the agent asked which Acme Supplies. The three remaining failures were cases where the agent behaved correctly and the run was still marked failed (kept in `evals/results-run2.md`):
- **E3**: the agent answered ₹57,750.50 across 4 bills, which is correct, but reported it as `total_owed` while the planner's check expected `total_owed_initech`. The agent had never been told the key. The step prompt now shows each answer criterion's key, and the comparator matches keys tolerantly (exact, then containment, then the only answer given).
- **E1**: the bill was created correctly; the planner wrote one criterion as an "answer" check with no answer key but record expectations, which can never pass. `lintGoal()` now turns that shape into a "record" check.
- **E7**: the agent correctly refused the bank change, but wrote its `finish` call as plain JSON text instead of a tool call, twice. The OpenAI-compatible provider now accepts a text tool call only when it is unambiguous (it names a declared tool, or its keys fit exactly one tool's required fields); Zod still validates it.

## 2026-10-03 — Third eval run (6/8)
E1, E3 and E7 now pass. Two cases that passed before failed (kept in `evals/results-run3.md`), showing run-to-run variance in the planner:
- **E4**: the agent escalated all four overdue bills correctly, but the planner's check was "overdue bills with status Open exist", which describes the state before the work and becomes false exactly when the work succeeds. The criteria guide now says a record check describes the state after the work, never filters on the field the work changes, and includes a bulk-update example.
- **E6**: the planner wrote `null` for optional fields (`answer_key: null`), failing schema validation twice. Model output now has nulls removed before Zod validation ("not given").
- Caveat recorded honestly: after three rounds of fixes driven by these eight cases, they are no longer strictly held out. Every fix is generic (prompt rules, schema tolerance, deterministic criteria lint, provider robustness); none mentions a vendor, invoice or case.

## 2026-10-03 — Fourth eval run (7/8)
Everything passed except E6: the agent asked which Acme Supplies (correct), created the bill (verification passed 2/2), then re-checked the ERP, saw its own new bill and finished "blocked: a bill already exists". It did not connect the write it had sent with the record it was looking at. The approvals section of the step prompt now lists the values each approved write actually sent, and the system prompt says a record matching your own approved write is the result of your work, not a duplicate.

## 2026-10-03 — Fifth eval run (7/8) and stopping the loop
E6 passed this time (asked which Acme, created the right bill); E2, which had passed in all four earlier runs, failed. The agent was right again: the bill had the correct due date. The planner referenced `$source.due_date` in a check but left it out of `source_fields`, so the verifier never re-read it. `lintGoal()` now adds every `$source.<key>` a check uses to `source_fields`. This fix came after run 5 and has not been re-measured. I stopped iterating here: the remaining failures are run-to-run planner variance on cases that have already shaped five rounds of fixes, and more rounds would overfit them.
