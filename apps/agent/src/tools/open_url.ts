import { z } from "zod";
import { config } from "../config.js";
import { ToolInputError } from "../recovery.js";
import { defineTool } from "./types.js";

export default defineTool({
  name: "open_url",
  description: "Navigate the browser to a URL or a path such as /portal/vendors. Only Acme Corp systems are reachable.",
  schema: z.object({ url: z.string().describe("Absolute URL or path starting with /") }),
  observes: true,
  async run({ url }, { session }) {
    const target = new URL(url, config.baseUrl);
    if (target.origin !== new URL(config.baseUrl).origin) throw new ToolInputError(`Only ${config.baseUrl} is allowed, not ${target.origin}.`);
    await session.page.goto(target.toString(), { waitUntil: "domcontentloaded" });
    return { ok: true, result: `opened ${target.pathname}${target.search}` };
  },
});
