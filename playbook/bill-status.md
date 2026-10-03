---
name: bill-status
description: Bill statuses, what "overdue" and "outstanding" mean, and how to escalate or mark bills paid.
rule: Overdue means unpaid past its due date; outstanding is everything still unpaid.
applies_to: [overdue, escalate, outstanding, total owed, mark paid, bill status, reconcile]
---
# Bill status rules

- Statuses: **Open** (unpaid), **Escalated** (unpaid, chased with the vendor's account manager), **Paid**.
- **Overdue** = not Paid and due date before today's business date. The ERP tags these "Overdue" in the bills list.
- **Outstanding** (what we owe a vendor) = the sum of amounts of all its bills that are **not Paid** (Open or Escalated), overdue or not.
  Report it in rupees with two decimals, e.g. `57750.50`, and say how many bills it covers.
- To **escalate** an overdue bill: open the bill, set Change status to Escalated, click "Update status". Do this for each overdue bill; do not change bills that are not overdue.
- To **mark a bill paid**: open the bill, set status to Paid, click "Update status".
- Use the bills list filters (vendor, status) to find the bills, and read amounts from the list.

## Done means (write criteria like these)
- Escalation: every overdue bill of the vendor has status Escalated (ERP record).
- Totals: the reported total equals the sum over the vendor's unpaid bills in the ERP (computed in code).
