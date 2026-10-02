// Scripted (no LLM) walk through T1 against the live mock apps with chaos on.
// Proves the traps fire in a real browser and that page.route can hold ERP writes.
import { chromium } from "playwright";

const BASE = process.env.MOCK_BASE_URL ?? "http://localhost:4000";
const shots = process.env.SHOTS_DIR ?? "runs/smoke";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ extraHTTPHeaders: { "x-clerk-run": `smoke-${Date.now()}`, "x-clerk-chaos": "default" } });
const page = await ctx.newPage();
const snap = () => page.locator("body").ariaSnapshot({ mode: "ai" } as never);
const ref = (s: string, re: string) => s.match(new RegExp(`${re}[^\\n]*\\[ref=([a-z0-9]+)\\]`))?.[1];

// The approval gate idea: hold every non-GET to /erp/*.
const held: string[] = [];
await page.route(`${BASE}/erp/**`, async (route) => {
  const req = route.request();
  if (req.method() !== "GET" && !req.url().endsWith("/login")) held.push(`${req.method()} ${new URL(req.url()).pathname} ${req.postData()}`);
  await route.continue();
});

await page.goto(`${BASE}/portal/vendors/V-001/invoices`);
await page.fill("#username", "ap.clerk"); await page.fill("#password", "portal-demo-pass"); await page.click("button[type=submit]");
console.log("portal list after login ->", page.url(), (await page.title()));
if ((await page.title()).startsWith("Error")) { await page.reload(); console.log("retried ->", await page.title()); }
await page.screenshot({ path: `${shots}/portal-invoices.png`, fullPage: true });
console.log((await snap()).split("\n").filter((l) => l.includes("INV-")).join("\n"));

await page.goto(`${BASE}/erp/bills/new`);
await page.fill("#username", "ap.clerk"); await page.fill("#password", "erp-demo-pass"); await page.click("button[type=submit]");
const s1 = await snap();
const saveRef = ref(s1, 'button "Save"');
console.log("button in first snapshot:", saveRef);
await page.selectOption("#vendor_id", "V-001");
await page.fill("#invoice_no", "INV-1042"); await page.fill("#amount", "48250.00"); await page.fill("#due_date", "2026-10-30");
await page.waitForTimeout(1500);
try { await page.locator(`aria-ref=${saveRef}`).click({ timeout: 1000 }); console.log("UNEXPECTED: stale ref clicked"); }
catch { console.log("stale ref trap fired: Save button was replaced"); }
const s2 = await snap();
await page.locator(`aria-ref=${ref(s2, 'button "Create bill"')}`).click();
await page.waitForLoadState();
console.log("after ISO submit ->", (await page.locator("[role=alert]").textContent())?.replace(/\s+/g, " ").trim());
await page.fill("#due_date", "30/10/2026");
await page.waitForTimeout(1500);
await page.getByRole("button", { name: "Create bill" }).click();
await page.waitForURL(/\/erp\/bills\/\d+/);
await page.screenshot({ path: `${shots}/erp-bill.png`, fullPage: true });
console.log("created ->", page.url());
console.log("held writes:\n " + held.join("\n "));
await browser.close();
