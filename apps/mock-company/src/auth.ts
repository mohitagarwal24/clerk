import { randomBytes } from "node:crypto";
import type { Context, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";

export type AppName = "portal" | "erp";

export const CREDENTIALS: Record<AppName, { user: string; pass: string }> = {
  portal: { user: process.env.PORTAL_USER ?? "ap.clerk", pass: process.env.PORTAL_PASS ?? "portal-demo-pass" },
  erp: { user: process.env.ERP_USER ?? "ap.clerk", pass: process.env.ERP_PASS ?? "erp-demo-pass" },
};

export class Sessions {
  private byToken = new Map<string, { app: AppName; user: string }>();

  login(c: Context, app: AppName, user: string) {
    const token = randomBytes(16).toString("hex");
    this.byToken.set(token, { app, user });
    setCookie(c, `${app}_session`, token, { path: `/${app}`, httpOnly: true, sameSite: "Lax" });
  }

  logout(c: Context, app: AppName) {
    const token = getCookie(c, `${app}_session`);
    if (token) this.byToken.delete(token);
    deleteCookie(c, `${app}_session`, { path: `/${app}` });
  }

  user(c: Context, app: AppName): string | null {
    const token = getCookie(c, `${app}_session`);
    const s = token ? this.byToken.get(token) : undefined;
    return s && s.app === app ? s.user : null;
  }

  /** Middleware: pages redirect to login, JSON endpoints answer 401. */
  require(app: AppName) {
    return async (c: Context, next: Next) => {
      const user = this.user(c, app);
      if (!user) {
        if (c.req.path.startsWith(`/${app}/api/`)) return c.json({ error: "not authenticated" }, 401);
        return c.redirect(`/${app}/login?next=${encodeURIComponent(c.req.path + (new URL(c.req.url).search))}`);
      }
      c.set("user", user);
      await next();
    };
  }
}
