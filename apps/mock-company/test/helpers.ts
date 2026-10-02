import { openDb } from "../src/db.js";
import { seedDb } from "../src/seed.js";
import { ChaosState, type Preset } from "../src/chaos.js";
import { Sessions } from "../src/auth.js";
import { createApp } from "../src/server.js";

export const TODAY = "2026-10-02";

export function makeApp() {
  const db = openDb(":memory:");
  seedDb(db, TODAY);
  const app = createApp({ db, chaos: new ChaosState(), sessions: new Sessions(), today: () => TODAY });
  return { app, db };
}

/** A tiny cookie-carrying client that mimics one browser context for one run. */
export function client(app: ReturnType<typeof makeApp>["app"], run?: { id: string; preset: Preset }) {
  const jar = new Map<string, string>();
  const request = async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (jar.size) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
    if (run) { headers.set("x-clerk-run", run.id); headers.set("x-clerk-chaos", run.preset); }
    const res = await app.request(path, { ...init, headers, redirect: "manual" });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const [k, v] = pair!.split("=");
      if (k) jar.set(k, v ?? "");
    }
    return res;
  };
  const form = (path: string, data: Record<string, string>) =>
    request(path, { method: "POST", body: new URLSearchParams(data), headers: { "content-type": "application/x-www-form-urlencoded" } });
  const login = (appName: "portal" | "erp") =>
    form(`/${appName}/login`, { username: "ap.clerk", password: appName === "erp" ? "erp-demo-pass" : "portal-demo-pass", next: `/${appName}/` });
  return { request, form, login };
}
