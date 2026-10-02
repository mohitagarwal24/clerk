import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type DB = Database.Database;

export const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_DB_PATH = join(PKG_ROOT, "data", "acme.sqlite");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS vendors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  gstin TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  bank_account TEXT NOT NULL,
  bank_ifsc TEXT NOT NULL
);
-- What vendors uploaded to the portal (the source documents)
CREATE TABLE IF NOT EXISTS portal_invoices (
  invoice_no TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL REFERENCES vendors(id),
  invoice_date TEXT NOT NULL,   -- ISO yyyy-mm-dd
  due_date TEXT NOT NULL,       -- ISO yyyy-mm-dd
  uploaded_at TEXT NOT NULL,    -- ISO datetime
  amount TEXT NOT NULL,         -- decimal string, rupees
  status TEXT NOT NULL,         -- Open | Superseded | Paid
  note TEXT NOT NULL DEFAULT '',
  pdf_file TEXT NOT NULL
);
-- The ERP's system of record
CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id TEXT NOT NULL REFERENCES vendors(id),
  invoice_no TEXT NOT NULL,
  amount TEXT NOT NULL,         -- decimal string
  due_date TEXT NOT NULL,       -- ISO yyyy-mm-dd (rendered DD/MM/YYYY)
  status TEXT NOT NULL,         -- Open | Escalated | Paid
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  UNIQUE (vendor_id, invoice_no)
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  run_id TEXT,
  action TEXT NOT NULL,
  detail TEXT NOT NULL
);
`;

export function openDb(path = process.env.MOCK_DB_PATH ?? DEFAULT_DB_PATH): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}

export type Vendor = {
  id: string; name: string; city: string; gstin: string;
  contact_email: string; bank_account: string; bank_ifsc: string;
};
export type PortalInvoice = {
  invoice_no: string; vendor_id: string; invoice_date: string; due_date: string;
  uploaded_at: string; amount: string; status: string; note: string; pdf_file: string;
};
export type Bill = {
  id: number; vendor_id: string; invoice_no: string; amount: string; due_date: string;
  status: string; notes: string; created_at: string; created_by: string;
};

export function audit(db: DB, runId: string | null, action: string, detail: unknown) {
  db.prepare("INSERT INTO audit_log (at, run_id, action, detail) VALUES (?, ?, ?, ?)")
    .run(new Date().toISOString(), runId, action, JSON.stringify(detail));
}
