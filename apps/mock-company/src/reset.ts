// `pnpm reset`: reseed the database and regenerate invoice PDFs. Chaos state lives in the
// server process; the server also exposes POST /__reset to clear it between demo takes.
import { openDb } from "./db.js";
import { seedDb, writeInvoicePdfs } from "./seed.js";

const db = openDb();
seedDb(db);
await writeInvoicePdfs();
db.close();

const base = process.env.MOCK_BASE_URL ?? "http://localhost:4000";
try {
  const res = await fetch(`${base}/__reset`, { method: "POST" });
  console.log(`Reseeded. Running server chaos state cleared (${res.status}).`);
} catch {
  console.log("Reseeded. (Mock server not running; chaos state starts clean on next start.)");
}
