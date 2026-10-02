import type { Hono } from "hono";
import type { Deps, Env } from "./server.js";
import { type AppName, CREDENTIALS } from "./auth.js";
import { audit } from "./db.js";
import { html, page } from "./html.js";

function safeNext(app: AppName, next: string | undefined) {
  return next && next.startsWith(`/${app}/`) ? next : `/${app}/`;
}

export function mountLogin(r: Hono<Env>, app: AppName, deps: Deps) {
  const form = (next: string, error?: string, username = "") => page({
    app, title: "Sign in",
    body: html`<div class="box" style="max-width:380px">
      <h1>Sign in</h1>
      ${error ? html`<div class="err" role="alert">${error}</div>` : ""}
      <form method="post" action="/${app}/login">
        <input type="hidden" name="next" value="${next}">
        <div class="form-row"><label for="username">User ID</label><input type="text" id="username" name="username" value="${username}" autocomplete="username"></div>
        <div class="form-row"><label for="password">Password</label><input type="password" id="password" name="password" autocomplete="current-password"></div>
        <div class="form-row"><label></label><button type="submit">Sign in</button></div>
      </form></div>`,
  });

  r.get("/login", (c) => c.html(form(safeNext(app, c.req.query("next")))));

  r.post("/login", async (c) => {
    const body = await c.req.parseBody();
    const username = String(body.username ?? "");
    const next = safeNext(app, String(body.next ?? ""));
    if (username !== CREDENTIALS[app].user || String(body.password ?? "") !== CREDENTIALS[app].pass) {
      return c.html(form(next, "Invalid user ID or password.", username), 401);
    }
    deps.sessions.login(c, app, username);
    audit(deps.db, c.get("runId"), `${app}.login`, { username });
    return c.redirect(next);
  });

  r.post("/logout", (c) => {
    deps.sessions.logout(c, app);
    return c.redirect(`/${app}/login`);
  });
}
