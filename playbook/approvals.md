---
name: approvals
description: What needs a human - every ERP write is held for approval at the network layer; when to ask the user instead of guessing.
rule: Every change to the ERP waits for a person to approve it; unclear requests get a question, not a guess.
applies_to: [any task, erp write, approval, ask user, ambiguity]
---
# Approvals and asking

- **Every write to the ERP is held for human approval** by the browser itself, whatever you clicked. You will see the approval outcome on the next observation. If a write is rejected, do not retry the same values; read the reviewer's note or ask the user.
- If approved values are changed (for example after a validation error), the reviewer is asked again. That is expected.
- **Ask instead of guessing** with `ask_user` when:
  - more than one record plausibly matches what the user named (for example two vendors whose names both match), or
  - the request needs information the systems do not hold.
  Offer the candidates as options.
- Read-only questions (totals, lists) need no approval.
