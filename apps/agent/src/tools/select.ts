import { z } from "zod";
import { defineTool } from "./types.js";

export default defineTool({
  name: "select",
  description: "Choose an option in a dropdown (combobox ref from the LATEST snapshot) by its visible label.",
  schema: z.object({ ref: z.string(), option: z.string().describe("Visible option label, e.g. 'Globex Corporation (Mumbai)'") }),
  observes: true,
  async run({ ref, option }, { session }) {
    const el = session.ref(ref);
    try {
      await el.selectOption({ label: option }, { timeout: 1500 });
    } catch {
      // Labels often carry extra text; fall back to a case-insensitive partial match.
      // Locators chained after aria-ref match nothing, so read the options from the element itself.
      const labels = await el.evaluate((s) => [...(s as HTMLSelectElement).options].map((o) => o.text.trim()));
      const hit = labels.find((l) => l.toLowerCase().includes(option.toLowerCase()));
      if (!hit) return { ok: false, result: `no option matching "${option}". Options: ${labels.join(" | ")}` };
      await el.selectOption({ label: hit }, { timeout: 2500 });
      option = hit;
    }
    return { ok: true, result: `selected "${option}" in ${ref}` };
  },
});
