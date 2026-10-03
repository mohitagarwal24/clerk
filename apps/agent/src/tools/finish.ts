import { FinishArgs } from "@clerk/shared";
import { defineTool } from "./types.js";

export default defineTool({
  name: "finish",
  description:
    "End the run and hand off to the independent verifier. Use outcome=completed only when the work is visible in the system; " +
    "outcome=blocked when you stopped on purpose. In sources, list the source-system page you chose from and the document you took values from, not the record you created.",
  schema: FinishArgs,
  observes: false,
  async run(args) {
    return { ok: true, result: `finish(${args.outcome})`, finish: args };
  },
});
