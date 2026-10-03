import { z } from "zod";
import { defineTool } from "./types.js";

export default defineTool({
  name: "type",
  description: "Replace the text in an input or textarea (ref from the LATEST snapshot). Set submit=true to press Enter afterwards (search boxes only; in a form, Enter submits the half-filled form).",
  schema: z.object({ ref: z.string(), text: z.string(), submit: z.boolean().optional() }),
  observes: true,
  async run({ ref, text, submit }, { session }) {
    const el = session.ref(ref);
    await el.fill(text, { timeout: 2500 });
    if (submit) await el.press("Enter");
    return { ok: true, result: `typed "${text}" into ${ref}${submit ? " and pressed Enter" : ""}` };
  },
});
