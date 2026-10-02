import { describe, expect, it } from "vitest";
import { ChaosState } from "../src/chaos.js";
import { client, makeApp } from "./helpers.js";

describe("chaos schedule", () => {
  it("is keyed by run: a new run gets the same traps again, and humans get none", () => {
    const chaos = new ChaosState();
    expect(chaos.forRequest("run-1", "default").traps.invoiceList500).toBe(1);
    expect(chaos.hit("run-1", "x")).toBe(1);
    expect(chaos.hit("run-1", "x")).toBe(2);
    expect(chaos.hit("run-2", "x")).toBe(0); // unknown run: never counted
    chaos.forRequest("run-2", "default");
    expect(chaos.hit("run-2", "x")).toBe(1);
    expect(chaos.forRequest(undefined, "default").preset).toBe("off");
  });

  it("keeps the preset a run started with", () => {
    const chaos = new ChaosState();
    chaos.forRequest("run-1", "rerun");
    expect(chaos.forRequest("run-1", "off").preset).toBe("rerun");
  });

  it("first invoice-list load fails with 500, the retry succeeds", async () => {
    const { app } = makeApp();
    const c = client(app, { id: "r1", preset: "default" });
    await c.login("portal");
    expect((await c.request("/portal/vendors/V-001/invoices")).status).toBe(500);
    const ok = await c.request("/portal/vendors/V-001/invoices");
    expect(ok.status).toBe(200);
    const body = await ok.text();
    // Superseded INV-1041 was uploaded last, so it is listed first.
    expect(body.indexOf("INV-1041")).toBeLessThan(body.indexOf("INV-1042"));
  });

  it("with chaos off nothing fails", async () => {
    const { app } = makeApp();
    const c = client(app, { id: "r2", preset: "off" });
    await c.login("portal");
    expect((await c.request("/portal/vendors/V-001/invoices")).status).toBe(200);
  });

  it("default preset swaps the button and drops the date hint", async () => {
    const { app } = makeApp();
    const c = client(app, { id: "r3", preset: "default" });
    await c.login("erp");
    const chaotic = await (await c.request("/erp/bills/new")).text();
    expect(chaotic).toContain("Create bill");
    expect(chaotic).not.toContain('placeholder="DD/MM/YYYY"');
    const calm = client(app, { id: "r4", preset: "off" });
    await calm.login("erp");
    const plain = await (await calm.request("/erp/bills/new")).text();
    expect(plain).not.toContain("Create bill");
    expect(plain).toContain('placeholder="DD/MM/YYYY"');
  });
});
