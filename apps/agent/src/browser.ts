// One Chromium context per run. Observation = AI-mode aria snapshot with [ref=…] tags, plus URL,
// HTTP status and visible errors. Refs are valid only for the latest snapshot.
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { config, secret, type System } from "./config.js";

export const SNAPSHOT_LIMIT = 8000;

export type Observation = {
  url: string;
  title: string;
  status: number | undefined;
  method: string | undefined;
  errors: string[];
  snapshot: string;
  truncated: boolean;
};

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({ headless: config.headless, executablePath: config.chromiumPath });
}

/** Headers that tie every request to this run's chaos schedule (see mock-company chaos.ts). */
export function runHeaders(runId: string, chaos: string): Record<string, string> {
  return { "x-clerk-run": runId, "x-clerk-chaos": chaos };
}

export class BrowserSession {
  /** Status and method of the last main-frame document response. */
  lastStatus: number | undefined;
  lastMethod: string | undefined;

  private constructor(readonly context: BrowserContext, readonly page: Page) {
    page.on("response", (res) => {
      const req = res.request();
      if (req.isNavigationRequest() && req.frame() === page.mainFrame()) {
        this.lastStatus = res.status();
        this.lastMethod = req.method();
      }
    });
  }

  static async open(browser: Browser, headers: Record<string, string>): Promise<BrowserSession> {
    const context = await browser.newContext({ extraHTTPHeaders: headers, acceptDownloads: true, viewport: { width: 1280, height: 860 } });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    return new BrowserSession(context, page);
  }

  /** Locator for a ref from the latest snapshot. */
  ref(ref: string) {
    return this.page.locator(`aria-ref=${ref.replace(/^\[?ref=/, "").replace(/\]$/, "")}`);
  }

  /** Let the page finish what the last action started. `beforeLoad` lets the gate hold a write first. */
  async settle(beforeLoad?: () => Promise<void>) {
    await this.page.waitForTimeout(250);
    if (beforeLoad) await beforeLoad();
    await this.page.waitForLoadState("domcontentloaded").catch(() => {});
    await this.page.waitForLoadState("networkidle", { timeout: 1500 }).catch(() => {});
  }

  async observe(): Promise<Observation> {
    const page = this.page;
    let snapshot = "";
    try {
      snapshot = await page.locator("body").ariaSnapshot({ mode: "ai", timeout: 5000 } as never);
    } catch (e) {
      snapshot = `(snapshot failed: ${(e as Error).message.split("\n")[0]})`;
    }
    const errors = await page.locator('[role="alert"]').allInnerTexts().catch(() => [] as string[]);
    if (this.lastStatus && this.lastStatus >= 400) errors.unshift(`HTTP ${this.lastStatus} on this page`);
    const truncated = snapshot.length > SNAPSHOT_LIMIT;
    return {
      url: page.url(),
      title: await page.title().catch(() => ""),
      status: this.lastStatus,
      method: this.lastMethod,
      errors: errors.map((e) => e.replace(/\s+/g, " ").trim()).filter(Boolean),
      snapshot: truncated ? snapshot.slice(0, SNAPSHOT_LIMIT) : snapshot,
      truncated,
    };
  }

  /** Screenshot with every password field masked. */
  async screenshot(path: string) {
    await this.page.screenshot({ path, mask: [this.page.locator('input[type="password"]')], maskColor: "#151917" }).catch(() => {});
  }

  async close() {
    await this.context.close().catch(() => {});
  }
}

/** Log in by filling the form in code. The model never sees or types credentials. */
export async function loginWith(page: Page, system: System): Promise<string> {
  const { user, pass } = secret(system);
  if (!page.url().includes(`/${system}/login`)) {
    await page.goto(`${config.baseUrl}/${system}/login?next=/${system}/`);
  }
  await page.locator('input[name="username"]').fill(user);
  await page.locator('input[name="password"]').fill(pass);
  await Promise.all([
    page.waitForLoadState("domcontentloaded"),
    page.locator('form[action$="/login"] button[type="submit"]').click(),
  ]);
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  const err = await page.locator('[role="alert"]').allInnerTexts().catch(() => []);
  if (page.url().includes("/login")) throw new Error(`Login to ${system} failed${err.length ? `: ${err.join(" ")}` : ""}`);
  return page.url();
}

/** Text the model sees for an observation. Page content is marked untrusted. */
export function formatObservation(o: Observation): string {
  const lines = [
    `URL: ${o.url}${o.status ? `  (HTTP ${o.status}${o.method && o.method !== "GET" ? ` after ${o.method}` : ""})` : ""}`,
    `Title: ${o.title}`,
    o.errors.length ? `Visible errors: ${o.errors.join(" | ")}` : "Visible errors: none",
    "Page (aria snapshot; refs are valid for THIS snapshot only):",
    `<untrusted source="page ${o.url}">`,
    o.snapshot,
    o.truncated ? `[snapshot truncated at ${SNAPSHOT_LIMIT} chars; open a more specific page or use search/filters]` : "",
    "</untrusted>",
  ];
  return lines.filter((l) => l !== "").join("\n");
}
