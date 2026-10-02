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
