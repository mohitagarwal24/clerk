---
name: invoice-entry
description: How to enter a vendor invoice into the ERP as a bill - which invoice counts as "latest", the duplicate check, field formats.
applies_to: [enter invoice, log bill, record invoice, create bill, accounts payable]
---
# Entering a vendor invoice as an ERP bill

1. **Find the vendor's invoices** in the Vendor Portal.
2. **Pick the right invoice.** "Latest" means the most recently uploaded invoice that is still valid. **Skip invoices marked Superseded** (read the Remarks; they usually name the replacement). Skip Paid invoices.
3. **Read the PDF.** Take the invoice number, the "Total payable" amount and the "Payment Due" date from the PDF, not from the portal page.
4. **Duplicate check before creating anything.** Search `/erp/bills` for the invoice number. If a bill for the same vendor and invoice number already exists, **do not create another one**: stop, and finish with outcome `blocked`, naming the existing bill number.
5. **Create the bill** at `/erp/bills/new`:
   - Vendor: choose the vendor from the dropdown.
   - Vendor invoice no.: exactly as on the PDF.
   - Amount: digits only with two decimals, no currency sign, e.g. `48250.00`.
   - Due date: **DD/MM/YYYY**, e.g. `30/10/2026`. The PDF may print the date in another format; convert it.
6. If the ERP shows a validation error, read it, fix the field, and submit again.
7. After saving, the ERP shows "Bill #N created". Note the bill number with `remember`.

Every ERP write is held for human approval automatically (see approvals). You do not need to ask separately.

## Done means (write criteria like these)
- Exactly one ERP bill for this vendor with the invoice number from the PDF.
- Its amount equals the PDF total; its due date equals the PDF due date; its status is Open.
