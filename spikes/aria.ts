// Spike: does Playwright's AI-mode aria snapshot give refs we can click by?
import { chromium } from "playwright";
import { createRequire } from "node:module";

const pwVersion = createRequire(import.meta.url)("playwright/package.json").version;

const html = `<!doctype html><title>Spike</title>
<h1>New bill</h1>
<form onsubmit="event.preventDefault(); document.querySelector('#out').textContent = 'saved ' + this.amount.value">
  <label>Amount <input name="amount"></label>
  <button type="submit">Create bill</button>
  <button type="button" aria-label="" onclick="document.querySelector('#out').textContent='icon'">⚙</button>
</form>
<p id="out" role="status"></p>`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
await page.setContent(html);

const snap = await page.locator("body").ariaSnapshot({ mode: "ai" } as never);
console.log(`Playwright ${pwVersion}\n--- snapshot ---\n${snap}\n----------------`);

const refOf = (label: string) => snap.match(new RegExp(`${label}[^\\n]*\\[ref=([a-z0-9]+)\\]`))?.[1];
const inputRef = refOf('textbox "Amount"');
const buttonRef = refOf('button "Create bill"');
if (!inputRef || !buttonRef) throw new Error("No refs in snapshot: use the data-clerk-ref fallback");

await page.locator(`aria-ref=${inputRef}`).fill("48250.00");
await page.locator(`aria-ref=${buttonRef}`).click();
console.log(`filled ${inputRef}, clicked ${buttonRef} ->`, await page.locator("#out").textContent());

// Refs belong to the snapshot that produced them; check what happens after the DOM changes.
await page.evaluate(() => document.querySelector("button")!.replaceWith(Object.assign(document.createElement("button"), { textContent: "Save" })));
try {
  await page.locator(`aria-ref=${buttonRef}`).click({ timeout: 1500 });
  console.log("stale ref still clicked (unexpected)");
} catch (e) {
  console.log("stale ref after DOM change ->", (e as Error).message.split("\n")[0]);
}
await browser.close();
