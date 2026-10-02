import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { type DB, openDb } from "./db.js";
import { ChaosState, type Preset, type Traps } from "./chaos.js";
import { Sessions } from "./auth.js";
import { portalRoutes } from "./portal/routes.js";
import { erpRoutes } from "./erp/routes.js";

export type Env = {
  Variables: {
    user: string;
    runId: string | null;
    preset: Preset;
    traps: Traps;
  };
};

export type Deps = { db: DB; chaos: ChaosState; sessions: Sessions; today: () => string };

export function createApp(deps: Deps) {
  const app = new Hono<Env>();

  // Resolve chaos for every request from the run headers the agent's browser sends.
  app.use("*", async (c, next) => {
    const ctx = deps.chaos.forRequest(c.req.header("x-clerk-run"), c.req.header("x-clerk-chaos"));
    c.set("runId", ctx.runId);
    c.set("preset", ctx.preset);
    c.set("traps", ctx.traps);
    await next();
  });

  app.get("/", (c) => c.html(`<!doctype html><title>Acme Corp</title><h1>Acme Corp mock systems</h1>
    <ul><li><a href="/portal">Supplier Invoice Portal</a></li><li><a href="/erp">ERP (Accounts Payable)</a></li></ul>`));
  app.get("/__health", (c) => c.json({ ok: true }));
  // Clears chaos state; with ?reseed=1 also reseeds the database (evals call this between cases).
  app.post("/__reset", async (c) => {
    deps.chaos.reset();
    if (c.req.query("reseed") === "1") {
      const { seedDb } = await import("./seed.js");
      seedDb(deps.db, deps.today());
    }
    return c.json({ ok: true, reseeded: c.req.query("reseed") === "1" });
  });

  app.route("/portal", portalRoutes(deps));
  app.route("/erp", erpRoutes(deps));
  return app;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ""));
if (isMain) {
  const { todayIso } = await import("./dates.js");
  const db = openDb();
  const count = (db.prepare("SELECT COUNT(*) AS n FROM vendors").get() as { n: number }).n;
  if (count === 0) {
    const { seedDb, writeInvoicePdfs } = await import("./seed.js");
    seedDb(db);
    await writeInvoicePdfs();
    console.log("Empty database: seeded.");
  }
  const app = createApp({ db, chaos: new ChaosState(), sessions: new Sessions(), today: () => todayIso() });
  const port = Number(process.env.MOCK_PORT ?? 4000);
  serve({ fetch: app.fetch, port }, () => console.log(`Acme Corp mock apps on http://localhost:${port}  (/portal, /erp)`));
}
