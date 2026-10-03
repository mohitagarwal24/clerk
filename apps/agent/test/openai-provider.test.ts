// The OpenAI-compatible adapter against a fake chat-completions server that misbehaves the way
// real free endpoints do: rejects tool_choice, answers in text, rate-limits.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { z } from "zod";
import { config } from "../src/config.js";
import { decide, structured } from "../src/llm.js";
import { openaiLLM, parseLooseJson } from "../src/providers/openai.js";

type Body = { model: string; tool_choice: unknown; tools: { function: { name: string; parameters: { properties: object } } }[]; messages: { content: string }[] };
let handler: (b: Body, n: number) => Response | Promise<Response>;
const seen: Body[] = [];
let auth = "";
let server: ReturnType<typeof serve>;

const toolReply = (name: string, args: unknown) => Response.json({
  choices: [{ message: { content: null, tool_calls: [{ type: "function", function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) } }] } }],
  usage: { prompt_tokens: 120, completion_tokens: 15 },
});
const textReply = (content: string) => Response.json({ choices: [{ message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 20 } });

beforeAll(async () => {
  const app = new Hono();
  app.post("/v1/chat/completions", async (c) => {
    const b = (await c.req.json()) as Body;
    seen.push(b);
    auth = c.req.header("authorization") ?? "";
    return handler(b, seen.length);
  });
  server = await new Promise((r) => { const s = serve({ fetch: app.fetch, port: 4997 }, () => r(s)); });
});
afterAll(() => server.close());

const llm = (model: string) => openaiLLM({ model, baseUrl: "http://localhost:4997/v1", apiKey: "nvapi-test", rpm: 6000 });
const tools = [
  { name: "click", description: "click", schema: z.object({ ref: z.string(), why: z.string() }) },
  { name: "finish", description: "finish", schema: z.object({ summary: z.string(), why: z.string() }) },
];
const meter = () => {};

describe("OpenAI-compatible provider", () => {
  it("forces a tool call, sends JSON-schema tools and the key, parses string arguments", async () => {
    seen.length = 0;
    handler = () => toolReply("click", '{"ref":"e12","why":"open it"}');
    const out = await llm("m1").callTool({ system: "s", prompt: "p", tools, purpose: "t" });
    expect(out).toMatchObject({ name: "click", args: { ref: "e12", why: "open it" }, usage: { inputTokens: 120, outputTokens: 15 } });
    expect(seen[0]!.tool_choice).toBe("required");
    expect(seen[0]!.tools.map((t) => t.function.name)).toEqual(["click", "finish"]);
    expect(seen[0]!.tools[0]!.function.parameters.properties).toHaveProperty("ref");
    expect(auth).toBe("Bearer nvapi-test");
  });

  it("falls back to tool_choice=auto when the server rejects forcing, and remembers it", async () => {
    seen.length = 0;
    handler = (b) => (b.tool_choice === "required" ? new Response('{"error":"tool_choice \\"required\\" is not supported"}', { status: 400 }) : toolReply("finish", { summary: "ok", why: "done" }));
    const p = llm("m2");
    expect((await p.callTool({ system: "s", prompt: "p", tools, purpose: "t" })).name).toBe("finish");
    await p.callTool({ system: "s", prompt: "p", tools, purpose: "t" });
    expect(seen.map((b) => b.tool_choice)).toEqual(["required", "auto", "auto"]);
  });

  it("structured output via a forced submit tool, or JSON in the text when the model ignores tools", async () => {
    seen.length = 0;
    const schema = z.object({ skills: z.array(z.string()) });
    handler = () => toolReply("submit", { skills: ["systems"] });
    expect(await structured(llm("m3"), { system: "s", prompt: "p", schema, purpose: "pick" }, meter)).toEqual({ skills: ["systems"] });
    expect(seen[0]!.tool_choice).toEqual({ type: "function", function: { name: "submit" } });
    handler = () => textReply('Sure:\n```json\n{"skills": ["approvals"]}\n```');
    expect(await structured(llm("m3"), { system: "s", prompt: "p", schema, purpose: "pick" }, meter)).toEqual({ skills: ["approvals"] });
  });

  it("retries 429 using Retry-After", async () => {
    seen.length = 0;
    handler = (_b, n) => (n === 1 ? new Response("slow down", { status: 429, headers: { "retry-after": "1" } }) : toolReply("click", { ref: "e1", why: "x" }));
    const t0 = Date.now();
    expect((await llm("m4").callTool({ system: "s", prompt: "p", tools, purpose: "t" })).name).toBe("click");
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
    expect(seen).toHaveLength(2);
  });

  it("a text answer instead of a tool call is re-prompted once by decide()", async () => {
    seen.length = 0;
    handler = (_b, n) => (n === 1 ? textReply("I think I should click the link.") : toolReply("click", { ref: "e7", why: "retry" }));
    const out = await decide(llm("m5"), { system: "s", prompt: "p", tools, purpose: "t" }, meter);
    expect(out).toEqual({ name: "click", args: { ref: "e7", why: "retry" } });
    expect(seen[1]!.messages.at(-1)!.content).toContain("YOUR PREVIOUS REPLY WAS REJECTED");
  });

  it("client errors other than tool_choice are not retried", async () => {
    handler = () => new Response('{"error":"invalid api key"}', { status: 401 });
    await expect(llm("m6").callTool({ system: "s", prompt: "p", tools, purpose: "t" })).rejects.toThrow(/HTTP 401/);
  });

  it("falls back to the next model when one is retired (410), and stays on it", async () => {
    seen.length = 0;
    config.llmFallbackModels.splice(0, Infinity, "m-backup");
    handler = (b) => (b.model === "m-gone"
      ? new Response('{"status":410,"detail":"The model has reached its end of life"}', { status: 410 })
      : toolReply("click", { ref: "e3", why: "x" }));
    const p = llm("m-gone");
    const out = await p.callTool({ system: "s", prompt: "p", tools, purpose: "t" });
    expect(out).toMatchObject({ name: "click", usage: { model: "m-backup" } });
    await p.callTool({ system: "s", prompt: "p", tools, purpose: "t" });
    expect(seen.map((b) => b.model)).toEqual(["m-gone", "m-backup", "m-backup"]);
    config.llmFallbackModels.splice(0, Infinity);
  });

  it("parses JSON wrapped in prose or fences", () => {
    expect(parseLooseJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseLooseJson('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(parseLooseJson('Here you go: {"a":3} hope that helps')).toEqual({ a: 3 });
    expect(() => parseLooseJson("no json here")).toThrow(/Not JSON/);
  });
});
