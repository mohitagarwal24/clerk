// The gate against a real browser and a tiny server: whatever triggers a write, it is held.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { chromium, type Browser } from "playwright";
import type { ApprovalDecision, ApprovalRequest } from "@clerk/shared";
import { ApprovalGate, applyEdits, changedFields, isGated, parseBody, redact } from "../src/gate.js";

describe("gate helpers", () => {
  it("gates every non-GET to /erp except sign-in, and nothing outside /erp", () => {
    expect(isGated("POST", "http://x/erp/bills")).toBe(true);
    expect(isGated("PUT", "http://x/erp/vendors/V-001")).toBe(true);
    expect(isGated("DELETE", "http://x/erp/bills/3")).toBe(true);
    expect(isGated("GET", "http://x/erp/bills")).toBe(false);
    expect(isGated("POST", "http://x/erp/login")).toBe(false);
    expect(isGated("POST", "http://x/portal/login")).toBe(false);
    expect(isGated("POST", "http://x/erpx/bills")).toBe(false);
  });

  it("parses urlencoded, JSON and multipart bodies", () => {
    expect(parseBody("a=1&b=x%20y", "application/x-www-form-urlencoded")).toEqual([{ name: "a", value: "1" }, { name: "b", value: "x y" }]);
    expect(parseBody('{"a":1,"b":"z"}', "application/json")).toEqual([{ name: "a", value: "1" }, { name: "b", value: "z" }]);
    expect(parseBody('--X\r\nContent-Disposition: form-data; name="amount"\r\n\r\n12.00\r\n--X--', "multipart/form-data; boundary=X")).toEqual([{ name: "amount", value: "12.00" }]);
    expect(parseBody(null)).toEqual([]);
  });

  it("redacts secrets, applies edits, reports changed fields", () => {
    expect(redact([{ name: "password", value: "p" }])).toEqual([{ name: "password", value: "••••••" }]);
    expect(applyEdits([{ name: "due", value: "2026-10-30" }], { due: "30/10/2026" })).toEqual([{ name: "due", value: "30/10/2026" }]);
    expect(changedFields([{ name: "a", value: "1" }, { name: "b", value: "2" }], [{ name: "a", value: "1" }, { name: "b", value: "3" }])).toEqual(["b"]);
    expect(changedFields([{ name: "a", value: "1" }], undefined)).toEqual([]);
  });
});

describe("gate in a real browser", () => {
  let browser: Browser;
  let server: ReturnType<typeof serve>;
  const received: Record<string, string>[] = [];
  const base = "http://localhost:4998";

  beforeAll(async () => {
    const app = new Hono();
    const form = `<form method="post" action="/erp/bills"><input name="amount" value="10.00"><button>Save</button></form>
      <button id="js" onclick="fetch('/erp/bills',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({amount:'99.00'})}).then(r=>document.title='js '+r.status)">JS write</button>`;
    app.get("/erp/form", (c) => c.html(form));
    app.post("/erp/bills", async (c) => {
      const ct = c.req.header("content-type") ?? "";
      received.push(ct.includes("json") ? await c.req.json() : (await c.req.parseBody()) as Record<string, string>);
      return c.html("<title>saved</title>saved");
    });
    server = await new Promise((r) => { const s = serve({ fetch: app.fetch, port: 4998 }, () => r(s)); });
    browser = await chromium.launch();
  });
  afterAll(async () => { await browser.close(); server.close(); });

  async function withGate(decide: (r: ApprovalRequest) => ApprovalDecision) {
    const context = await browser.newContext();
    const asked: ApprovalRequest[] = [];
    const gate = new ApprovalGate({ step: () => 1, approver: async (r) => { asked.push(r); return decide(r); } });
    await gate.install(context);
    const page = await context.newPage();
    await page.goto(`${base}/erp/form`);
    return { page, gate, asked, close: () => context.close() };
  }

  it("holds a form submit, shows the parsed body, and sends it only after approval", async () => {
    received.length = 0;
    const g = await withGate(() => ({ approve: true }));
    await g.page.click("button");
    await g.page.waitForLoadState();
    await g.gate.idle();
    expect(g.asked).toHaveLength(1);
    expect(g.asked[0]).toMatchObject({ method: "POST", path: "/erp/bills", fields: [{ name: "amount", value: "10.00" }] });
    expect(received).toEqual([{ amount: "10.00" }]);
    await g.close();
  });

  it("rejected writes never reach the server", async () => {
    received.length = 0;
    const g = await withGate(() => ({ approve: false, note: "wrong vendor" }));
    await g.page.click("button");
    await g.page.waitForLoadState();
    await g.gate.idle();
    expect(received).toEqual([]);
    expect(await g.page.textContent("body")).toContain("wrong vendor");
    await g.close();
  });

  it("holds writes that do not come from a form (script fetch), and sends human edits", async () => {
    received.length = 0;
    const g = await withGate(() => ({ approve: true, fields: { amount: "98.00" } }));
    await g.page.click("#js");
    await g.page.waitForFunction(() => document.title.startsWith("js"));
    expect(g.asked[0]!.fields).toEqual([{ name: "amount", value: "99.00" }]);
    expect(received).toEqual([{ amount: "98.00" }]);
    await g.close();
  });

  it("asks again on resubmission and shows the previous approved values", async () => {
    const g = await withGate(() => ({ approve: true }));
    await g.page.click("button");
    await g.page.waitForLoadState();
    await g.page.goto(`${base}/erp/form`);
    await g.page.fill("input", "11.00");
    await g.page.click("button");
    await g.page.waitForLoadState();
    await g.gate.idle();
    expect(g.asked).toHaveLength(2);
    expect(g.asked[1]!.previous).toEqual([{ name: "amount", value: "10.00" }]);
    expect(changedFields(g.asked[1]!.fields, g.asked[1]!.previous)).toEqual(["amount"]);
    await g.close();
  });
});
