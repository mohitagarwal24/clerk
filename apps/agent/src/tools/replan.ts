import { z } from "zod";
import { defineTool } from "./types.js";

export default defineTool({
  name: "replan",
  description: "Rewrite the remaining plan when the current one no longer fits what you found. Success criteria stay fixed.",
  schema: z.object({ reason: z.string() }),
  observes: false,
  async run({ reason }, { replan }) {
    return { ok: true, result: await replan(reason) };
  },
});
