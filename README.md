# Clerk

An autonomous AI task worker for back-office work. Spec: [PRD.md](PRD.md). Rules for coding agents: [AGENTS.md](AGENTS.md).

> Work in progress. Blocks 0–1 done (spike, mock company). See [docs/decisions.md](docs/decisions.md).

## Run what exists so far
```bash
pnpm i
cp .env.example .env          # add GEMINI_API_KEY, then pin GEMINI_MODEL
pnpm reset                    # seed the database and invoice PDFs
pnpm dev:mock                 # http://localhost:4000/portal and /erp
pnpm test && pnpm typecheck
pnpm spike:aria               # Playwright AI snapshot + ref click
pnpm spike:gemini             # forced function call + model list (needs .env)
```
Mock logins: `ap.clerk` / `portal-demo-pass` (portal), `ap.clerk` / `erp-demo-pass` (ERP).

Chaos: send `x-clerk-run: <id>` and `x-clerk-chaos: default|rerun|off` headers. `npx tsx spikes/smoke.ts` walks T1 through every trap without an LLM.
