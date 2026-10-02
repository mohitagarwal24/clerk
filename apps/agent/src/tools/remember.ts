import { z } from "zod";
import { remember } from "../memory.js";
import { defineTool } from "./types.js";

export default defineTool({
  name: "remember",
  description: "Save a fact to working memory (values read from documents, record ids, decisions and why). Tool outputs are shown only once; memory persists.",
  schema: z.object({ key: z.string(), value: z.string() }),
  observes: false,
  async run({ key, value }, { state, emit }) {
    remember(state, key, value);
    emit({ type: "memory", facts: { ...state.facts } });
    return { ok: true, result: `remembered ${key} = ${value}` };
  },
});
