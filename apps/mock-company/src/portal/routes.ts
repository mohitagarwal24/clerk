import { Hono } from "hono";
import type { Deps, Env } from "../server.js";
import type { PortalInvoice, Vendor } from "../db.js";
import { mountLogin } from "../login.js";
import { html, page, raw } from "../html.js";
import { isoToDmy } from "../dates.js";
import { INVOICES, renderInvoicePdf } from "../seed.js";

export function portalRoutes(deps: Deps) {
  const r = new Hono<Env>();
  mountLogin(r, "portal", deps);
  r.use("*", async (c, next) => (c.req.path.endsWith("/login") ? next() : deps.sessions.require("portal")(c, next)));

  const nav = raw(`<nav><a href="/portal/vendors">Vendors</a><a href="/portal/invoices">All invoices</a></nav>`);
  const view = (user: string, title: string, body: ReturnType<typeof html>) => page({ app: "portal", title, user, nav, body });

  r.get("/", (c) => c.redirect("/portal/vendors"));

  r.get("/vendors", (c) => {
    const vendors = deps.db.prepare(`SELECT v.id, v.name, v.city, COUNT(p.invoice_no) AS n
      FROM vendors v JOIN portal_invoices p ON p.vendor_id = v.id GROUP BY v.id ORDER BY v.name`).all() as (Vendor & { n: number })[];
    return c.html(view(c.get("user"), "Vendors", html`<h1>Vendors</h1>
      <table class="grid"><tr><th>Vendor code</th><th>Vendor</th><th>City</th><th>Invoices</th></tr>
      ${vendors.map((v) => html`<tr><td>${v.id}</td><td><a href="/portal/vendors/${v.id}/invoices">${v.name}</a></td><td>${v.city}</td><td>${v.n}</td></tr>`)}
      </table>`));
  });

  const invoiceTable = (rows: (PortalInvoice & { vendor_name: string })[], showVendor: boolean) => html`
    <table class="grid"><tr>${showVendor ? html`<th>Vendor</th>` : ""}<th>Invoice No.</th><th>Invoice date</th><th>Uploaded</th><th>Status</th><th>Remarks</th></tr>
    ${rows.map((p) => html`<tr>${showVendor ? html`<td>${p.vendor_name}</td>` : ""}
      <td><a href="/portal/invoices/${p.invoice_no}">${p.invoice_no}</a></td>
      <td>${isoToDmy(p.invoice_date)}</td><td>${isoToDmy(p.uploaded_at.slice(0, 10))} ${p.uploaded_at.slice(11, 16)}</td>
      <td><span class="tag ${p.status}">${p.status}</span></td><td>${p.note}</td></tr>`)}
    </table>`;

  r.get("/invoices", (c) => {
    const rows = deps.db.prepare(`SELECT p.*, v.name AS vendor_name FROM portal_invoices p JOIN vendors v ON v.id = p.vendor_id
      ORDER BY p.uploaded_at DESC`).all() as (PortalInvoice & { vendor_name: string })[];
    return c.html(view(c.get("user"), "All invoices", html`<h1>All uploaded invoices</h1><p class="muted">Newest upload first.</p>${invoiceTable(rows, true)}`));
  });

  r.get("/vendors/:id/invoices", (c) => {
    // Trap: the first N loads of an invoice list in this run fail with a server error.
    const n = deps.chaos.hit(c.get("runId"), "portal.invoiceList");
    if (n > 0 && n <= c.get("traps").invoiceList500) {
      return c.html(page({ app: "portal", title: "Error", body: html`<h1>500 Internal Server Error</h1><p>The invoice service is temporarily unavailable. Please try again.</p>` }), 500);
    }
    const vendor = deps.db.prepare("SELECT * FROM vendors WHERE id = ?").get(c.req.param("id")) as Vendor | undefined;
    if (!vendor) return c.notFound();
    const rows = deps.db.prepare(`SELECT p.*, v.name AS vendor_name FROM portal_invoices p JOIN vendors v ON v.id = p.vendor_id
      WHERE p.vendor_id = ? ORDER BY p.uploaded_at DESC`).all(vendor.id) as (PortalInvoice & { vendor_name: string })[];
    return c.html(view(c.get("user"), `${vendor.name} invoices`, html`<h1>Invoices from ${vendor.name}</h1>
      <p class="muted">Newest upload first. Amounts are on the invoice PDF.</p>${invoiceTable(rows, false)}`));
  });

  r.get("/invoices/:no", (c) => {
    const p = deps.db.prepare(`SELECT p.*, v.name AS vendor_name FROM portal_invoices p JOIN vendors v ON v.id = p.vendor_id
      WHERE p.invoice_no = ?`).get(c.req.param("no")) as (PortalInvoice & { vendor_name: string }) | undefined;
    if (!p) return c.notFound();
    return c.html(view(c.get("user"), p.invoice_no, html`<h1>Invoice ${p.invoice_no}</h1>
      <div class="box"><table class="grid" style="width:auto">
        <tr><th>Vendor</th><td>${p.vendor_name}</td></tr>
        <tr><th>Invoice date</th><td>${isoToDmy(p.invoice_date)}</td></tr>
        <tr><th>Uploaded</th><td>${isoToDmy(p.uploaded_at.slice(0, 10))} ${p.uploaded_at.slice(11, 16)}</td></tr>
        <tr><th>Status</th><td><span class="tag ${p.status}">${p.status}</span></td></tr>
        ${p.note ? html`<tr><th>Remarks</th><td>${p.note}</td></tr>` : ""}
        <tr><th>Document</th><td><a href="/portal/invoices/${p.invoice_no}/pdf" download="${p.pdf_file}">Download PDF (${p.pdf_file})</a></td></tr>
      </table></div>
      <p><a href="/portal/vendors/${p.vendor_id}/invoices">Back to ${p.vendor_name} invoices</a></p>`));
  });

  r.get("/invoices/:no/pdf", async (c) => {
    const inv = INVOICES.find((i) => i.invoice_no === c.req.param("no"));
    if (!inv) return c.notFound();
    const bytes = await renderInvoicePdf(inv);
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${inv.invoice_no}.pdf"`,
    });
  });

  return r;
}
