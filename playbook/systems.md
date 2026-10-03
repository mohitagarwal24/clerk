---
name: systems
description: Where things live at Acme Corp - Vendor Portal (source invoices) and ERP (bills, vendors) - with URLs and page layout.
rule: Invoices come from the Vendor Portal; bills and vendors live in the ERP.
applies_to: [any task, portal, erp, invoices, bills, vendors]
---
# Acme Corp systems

## Vendor Portal (source documents) - `/portal`
- What vendors upload. Read-only for us.
- `/portal/vendors`: vendor list. Click a vendor to see its invoices.
- `/portal/vendors/<vendor code>/invoices`: that vendor's invoices, **newest upload first**, with Status (Open, Superseded, Paid) and Remarks.
- `/portal/invoices/<invoice no>`: invoice detail with a "Download PDF" link.
- **Amounts and due dates are only on the invoice PDF.** Download it and read it with `read_pdf`.

## ERP (system of record) - `/erp`
- `/erp/bills`: all bills, with search (invoice no. or vendor name), status and vendor filters. Overdue bills carry an "Overdue" tag next to the due date.
- `/erp/bills/new`: new-bill form (Vendor, Vendor invoice no., Amount, Due date, Notes).
- `/erp/bills/<id>`: bill detail with a "Change status" control (Open, Escalated, Paid).
- `/erp/vendors` and `/erp/vendors/<code>`: vendor master, including bank details.
- The ERP shows dates as DD/MM/YYYY.

## Logging in
Use the `login` tool with `portal` or `erp`. Never type credentials yourself. If a page shows a "Sign in" form, call `login`.
