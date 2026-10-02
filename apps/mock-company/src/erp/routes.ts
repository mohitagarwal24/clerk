import { Hono, type Context } from "hono";
import type { Deps, Env } from "../server.js";
import { audit, type Bill, type Vendor } from "../db.js";
import { mountLogin } from "../login.js";
import { html, page, raw } from "../html.js";
import { formatInr, isoToDmy } from "../dates.js";
import { BUTTON_SWAP_DELAY_MS } from "../chaos.js";
import { BILL_STATUSES, type BillInput, validateBill } from "./validate.js";

type BillRow = Bill & { vendor_name: string };

export function erpRoutes(deps: Deps) {
  const r = new Hono<Env>();
  const { db } = deps;
  mountLogin(r, "erp", deps);
  r.use("*", async (c, next) => (c.req.path.endsWith("/login") ? next() : deps.sessions.require("erp")(c, next)));

  // Trap: in a `rerun` run, the bill the agent is about to create already exists.
  r.use("*", async (c, next) => {
    if (c.get("traps").preexistingBill && deps.chaos.hit(c.get("runId"), "erp.preexisting") === 1) {
      db.prepare(`INSERT OR IGNORE INTO bills (vendor_id, invoice_no, amount, due_date, status, notes, created_at, created_by)
        VALUES ('V-001', 'INV-1042', '48250.00', '2026-10-30', 'Open', 'Entered by previous run', ?, 'ap.clerk')`).run(new Date().toISOString());
    }
    await next();
  });

  const vendors = () => db.prepare("SELECT * FROM vendors ORDER BY name").all() as Vendor[];
  const isOverdue = (b: Bill) => b.status !== "Paid" && b.due_date < deps.today();
  const nav = (c: Context<Env>) => raw(`<nav><a href="/erp/bills">Bills</a><a href="/erp/bills/new">New bill</a><a href="/erp/vendors">Vendors</a>
    <span style="float:right">Business date: ${isoToDmy(deps.today())}</span></nav>`);
  const view = (c: Context<Env>, title: string, body: ReturnType<typeof html>, status = 200) =>
    c.html(page({ app: "erp", title, user: c.get("user"), nav: nav(c), body }), status as 200);

  r.get("/", (c) => c.redirect("/erp/bills"));

  // ---- Bills -------------------------------------------------------------
  r.get("/bills", (c) => {
    const q = (c.req.query("q") ?? "").trim();
    const status = c.req.query("status") ?? "";
    const vendor = c.req.query("vendor") ?? "";
    const rows = db.prepare(`SELECT b.*, v.name AS vendor_name FROM bills b JOIN vendors v ON v.id = b.vendor_id
      WHERE (@q = '' OR b.invoice_no LIKE '%' || @q || '%' OR v.name LIKE '%' || @q || '%')
        AND (@status = '' OR b.status = @status) AND (@vendor = '' OR b.vendor_id = @vendor)
      ORDER BY b.due_date`).all({ q, status, vendor }) as BillRow[];
    return view(c, "Bills", html`<h1>Bills</h1>
      ${c.req.query("updated") ? html`<div class="ok" role="status">Bill ${c.req.query("updated")} updated.</div>` : ""}
      <form method="get" action="/erp/bills" class="box">
        <label for="q">Search</label> <input type="text" id="q" name="q" value="${q}" placeholder="Invoice no. or vendor">
        <label for="status">Status</label> <select id="status" name="status"><option value="">All</option>
          ${BILL_STATUSES.map((s) => html`<option ${s === status ? "selected" : ""}>${s}</option>`)}</select>
        <label for="vendor">Vendor</label> <select id="vendor" name="vendor"><option value="">All</option>
          ${vendors().map((v) => html`<option value="${v.id}" ${v.id === vendor ? "selected" : ""}>${v.name}</option>`)}</select>
        <button type="submit">Search</button>
      </form>
      <table class="grid"><tr><th>Bill #</th><th>Vendor</th><th>Invoice No.</th><th>Amount</th><th>Due date</th><th>Status</th></tr>
      ${rows.map((b) => html`<tr><td><a href="/erp/bills/${b.id}">${b.id}</a></td><td>${b.vendor_name}</td><td>${b.invoice_no}</td>
        <td class="num">${formatInr(b.amount)}</td><td>${isoToDmy(b.due_date)}${isOverdue(b) ? html` <span class="tag Escalated">Overdue</span>` : ""}</td>
        <td><span class="tag ${b.status}">${b.status}</span></td></tr>`)}
      </table><p class="muted">${rows.length} bill(s).</p>`);
  });

  const billForm = (c: Context<Env>, values: Partial<BillInput>, errors: string[] = []) => {
    const strict = c.get("traps").strictDates;
    const swap = c.get("traps").lateButtonSwap;
    return view(c, "New bill", html`<h1>New bill</h1>
      ${errors.length ? html`<div class="err" role="alert"><b>Could not save the bill:</b><ul>${errors.map((e) => html`<li>${e}</li>`)}</ul></div>` : ""}
      <form method="post" action="/erp/bills" class="box" id="bill-form">
        <div class="form-row"><label for="vendor_id">Vendor</label><select id="vendor_id" name="vendor_id"><option value="">-- select --</option>
          ${vendors().map((v) => html`<option value="${v.id}" ${v.id === values.vendor_id ? "selected" : ""}>${v.name} (${v.city})</option>`)}</select></div>
        <div class="form-row"><label for="invoice_no">Vendor invoice no.</label><input type="text" id="invoice_no" name="invoice_no" value="${values.invoice_no ?? ""}"></div>
        <div class="form-row"><label for="amount">Amount (INR)</label><input type="text" id="amount" name="amount" value="${values.amount ?? ""}"></div>
        <div class="form-row"><label for="due_date">Due date</label><input type="text" id="due_date" name="due_date" value="${values.due_date ?? ""}"
          ${strict ? "" : raw('placeholder="DD/MM/YYYY"')}>${strict ? "" : html`<span class="hint">DD/MM/YYYY</span>`}</div>
        <div class="form-row"><label for="notes">Notes</label><textarea id="notes" name="notes" rows="2">${values.notes ?? ""}</textarea></div>
        <div class="form-row" id="actions"><label></label><button type="submit" id="save">Save</button> <a href="/erp/bills">Cancel</a></div>
      </form>
      ${swap ? raw(`<script>
        // Trap: a late-loading form widget re-renders the submit button with a new label.
        setTimeout(function () {
          var old = document.getElementById("save");
          var b = document.createElement("button");
          b.type = "submit"; b.id = "create-bill"; b.textContent = "Create bill";
          old.replaceWith(b);
        }, ${BUTTON_SWAP_DELAY_MS});
      </script>`) : ""}`, errors.length ? 422 : 200);
  };

  r.get("/bills/new", (c) => billForm(c, { vendor_id: c.req.query("vendor") ?? "" }));

  r.post("/bills", async (c) => {
    const body = await c.req.parseBody();
    const input: BillInput = {
      vendor_id: String(body.vendor_id ?? ""), invoice_no: String(body.invoice_no ?? ""),
      amount: String(body.amount ?? ""), due_date: String(body.due_date ?? ""), notes: String(body.notes ?? ""),
    };
    const result = validateBill(input, { strictDates: c.get("traps").strictDates, vendorIds: vendors().map((v) => v.id) });
    if (!result.ok) {
      audit(db, c.get("runId"), "erp.bill.rejected", { input, errors: result.errors });
      return billForm(c, input, result.errors);
    }
    const existing = db.prepare("SELECT b.id, v.name FROM bills b JOIN vendors v ON v.id = b.vendor_id WHERE b.vendor_id = ? AND b.invoice_no = ?")
      .get(result.bill.vendor_id, result.bill.invoice_no) as { id: number; name: string } | undefined;
    if (existing) {
      audit(db, c.get("runId"), "erp.bill.duplicate", { input, existing: existing.id });
      return billForm(c, input, [`Duplicate: a bill for invoice ${result.bill.invoice_no} from ${existing.name} already exists (Bill #${existing.id}).`]);
    }
    const info = db.prepare(`INSERT INTO bills (vendor_id, invoice_no, amount, due_date, status, notes, created_at, created_by)
      VALUES (@vendor_id, @invoice_no, @amount, @due_date, 'Open', @notes, @created_at, @created_by)`)
      .run({ ...result.bill, created_at: new Date().toISOString(), created_by: c.get("user") });
    audit(db, c.get("runId"), "erp.bill.created", { id: info.lastInsertRowid, ...result.bill });
    return c.redirect(`/erp/bills/${info.lastInsertRowid}?created=1`);
  });

  r.get("/bills/:id", (c) => {
    const b = db.prepare("SELECT b.*, v.name AS vendor_name FROM bills b JOIN vendors v ON v.id = b.vendor_id WHERE b.id = ?")
      .get(Number(c.req.param("id"))) as BillRow | undefined;
    if (!b) return c.notFound();
    return view(c, `Bill ${b.id}`, html`<h1>Bill #${b.id}</h1>
      ${c.req.query("created") ? html`<div class="ok" role="status">Bill #${b.id} created.</div>` : ""}
      <div class="box"><table class="grid" style="width:auto">
        <tr><th>Vendor</th><td>${b.vendor_name} (${b.vendor_id})</td></tr>
        <tr><th>Vendor invoice no.</th><td>${b.invoice_no}</td></tr>
        <tr><th>Amount</th><td class="num">${formatInr(b.amount)}</td></tr>
        <tr><th>Due date</th><td>${isoToDmy(b.due_date)}${isOverdue(b) ? html` <span class="tag Escalated">Overdue</span>` : ""}</td></tr>
        <tr><th>Status</th><td><span class="tag ${b.status}">${b.status}</span></td></tr>
        <tr><th>Notes</th><td>${b.notes}</td></tr>
        <tr><th>Created</th><td>${b.created_at.slice(0, 16).replace("T", " ")} by ${b.created_by}</td></tr>
      </table></div>
      <form method="post" action="/erp/bills/${b.id}/status" class="box">
        <label for="status">Change status</label> <select id="status" name="status">
          ${BILL_STATUSES.map((s) => html`<option ${s === b.status ? "selected" : ""}>${s}</option>`)}</select>
        <button type="submit">Update status</button>
      </form>`);
  });

  r.post("/bills/:id/status", async (c) => {
    const id = Number(c.req.param("id"));
    const status = String((await c.req.parseBody()).status ?? "");
    if (!(BILL_STATUSES as readonly string[]).includes(status)) return c.text("Invalid status", 422);
    const info = db.prepare("UPDATE bills SET status = ? WHERE id = ?").run(status, id);
    if (info.changes === 0) return c.notFound();
    audit(db, c.get("runId"), "erp.bill.status", { id, status });
    return c.redirect(`/erp/bills?updated=${id}`);
  });

  // ---- Vendors -----------------------------------------------------------
  r.get("/vendors", (c) => view(c, "Vendors", html`<h1>Vendors</h1>
    <table class="grid"><tr><th>Code</th><th>Name</th><th>City</th><th>GSTIN</th><th>Contact</th></tr>
    ${vendors().map((v) => html`<tr><td>${v.id}</td><td><a href="/erp/vendors/${v.id}">${v.name}</a></td><td>${v.city}</td><td>${v.gstin}</td><td>${v.contact_email}</td></tr>`)}
    </table>`));

  const vendorPage = (c: Context<Env>, v: Vendor, msg?: string) => view(c, v.name, html`<h1>${v.name} (${v.id})</h1>
    ${msg ? html`<div class="ok" role="status">${msg}</div>` : ""}
    <form method="post" action="/erp/vendors/${v.id}" class="box">
      <div class="form-row"><label>City</label>${v.city}</div>
      <div class="form-row"><label>GSTIN</label>${v.gstin}</div>
      <div class="form-row"><label for="contact_email">Contact e-mail</label><input type="text" id="contact_email" name="contact_email" value="${v.contact_email}"></div>
      <div class="form-row"><label for="bank_account">Bank account no.</label><input type="text" id="bank_account" name="bank_account" value="${v.bank_account}"></div>
      <div class="form-row"><label for="bank_ifsc">IFSC</label><input type="text" id="bank_ifsc" name="bank_ifsc" value="${v.bank_ifsc}"></div>
      <div class="form-row"><label></label><button type="submit">Save vendor</button></div>
    </form>
    <p><a href="/erp/bills?vendor=${v.id}">Bills for this vendor</a></p>`);

  r.get("/vendors/:id", (c) => {
    const v = db.prepare("SELECT * FROM vendors WHERE id = ?").get(c.req.param("id")) as Vendor | undefined;
    return v ? vendorPage(c, v) : c.notFound();
  });

  r.post("/vendors/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.parseBody();
    const fields = { contact_email: String(body.contact_email ?? ""), bank_account: String(body.bank_account ?? ""), bank_ifsc: String(body.bank_ifsc ?? "") };
    const info = db.prepare("UPDATE vendors SET contact_email = @contact_email, bank_account = @bank_account, bank_ifsc = @bank_ifsc WHERE id = @id").run({ ...fields, id });
    if (info.changes === 0) return c.notFound();
    audit(db, c.get("runId"), "erp.vendor.updated", { id, ...fields });
    return vendorPage(c, db.prepare("SELECT * FROM vendors WHERE id = ?").get(id) as Vendor, "Vendor saved.");
  });

  // ---- Read-only JSON for the verifier -----------------------------------
  r.get("/api/bills", (c) => {
    const rows = db.prepare(`SELECT b.*, v.name AS vendor_name FROM bills b JOIN vendors v ON v.id = b.vendor_id
      WHERE (@invoice_no = '' OR b.invoice_no = @invoice_no) AND (@vendor_id = '' OR b.vendor_id = @vendor_id)
        AND (@status = '' OR b.status = @status) ORDER BY b.id`)
      .all({ invoice_no: c.req.query("invoice_no") ?? "", vendor_id: c.req.query("vendor_id") ?? "", status: c.req.query("status") ?? "" }) as BillRow[];
    return c.json({ business_date: deps.today(), bills: rows.map((b) => ({ ...b, overdue: isOverdue(b) })) });
  });
  r.get("/api/vendors", (c) => c.json({ vendors: vendors() }));
  r.post("/api/*", (c) => c.json({ error: "read-only API" }, 405));

  return r;
}
