// Starts the real mock company (portal + ERP + chaos) in-process on the test port.
import { serve } from "@hono/node-server";
import { openDb } from "../../mock-company/src/db.js";
import { seedDb } from "../../mock-company/src/seed.js";
import { ChaosState } from "../../mock-company/src/chaos.js";
import { Sessions } from "../../mock-company/src/auth.js";
import { createApp } from "../../mock-company/src/server.js";

export const TODAY = "2026-10-02";

export async function startMock(port = 4999) {
  const db = openDb(":memory:");
  seedDb(db, TODAY);
  const app = createApp({ db, chaos: new ChaosState(), sessions: new Sessions(), today: () => TODAY });
  const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const s = serve({ fetch: app.fetch, port }, () => resolve(s));
  });
  return {
    db,
    reseed: () => seedDb(db, TODAY),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
