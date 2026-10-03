// Server-side read of the ERP's read-only JSON, signed in with the ERP login from .env.
// Used by the console's approval card (vendor names) and by evals. Never reaches the model.
import { config, secret } from "./config.js";

export type ErpRow = Record<string, unknown>;

export async function erpRows(resource: "bills" | "vendors"): Promise<ErpRow[]> {
  const { user, pass } = secret("erp");
  const login = await fetch(`${config.baseUrl}/erp/login`, {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: user, password: pass, next: "/erp/" }),
  });
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const res = await fetch(`${config.baseUrl}/erp/api/${resource}`, { headers: { cookie } });
  if (!res.ok) throw new Error(`ERP API ${resource}: HTTP ${res.status}`);
  return ((await res.json()) as Record<string, ErpRow[]>)[resource]!;
}
