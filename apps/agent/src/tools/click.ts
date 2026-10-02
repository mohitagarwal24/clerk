import { z } from "zod";
import { defineTool } from "./types.js";

export default defineTool({
  name: "click",
  description: "Click the element with this ref from the LATEST snapshot (links, buttons, checkboxes).",
  schema: z.object({ ref: z.string().describe("e.g. e12 or f2e23, from the current snapshot") }),
  observes: true,
  async run({ ref }, { session }) {
    await session.ref(ref).click({ timeout: 2500 });
    return { ok: true, result: `clicked ${ref}` };
  },
});
