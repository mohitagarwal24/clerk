import { z } from "zod";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { defineTool } from "./types.js";

export default defineTool({
  name: "download",
  description: "Click a download link (ref from the LATEST snapshot) and save the file. Returns the file name for read_pdf.",
  schema: z.object({ ref: z.string() }),
  observes: true,
  async run({ ref }, { session, state, dir }) {
    const [dl] = await Promise.all([session.page.waitForEvent("download", { timeout: 8000 }), session.ref(ref).click({ timeout: 2500 })]);
    const name = dl.suggestedFilename();
    const folder = join(dir, "downloads");
    mkdirSync(folder, { recursive: true });
    const path = join(folder, name);
    await dl.saveAs(path);
    state.downloads.push({ url: dl.url(), path, name });
    return { ok: true, result: `downloaded ${name} from ${new URL(dl.url()).pathname}` };
  },
});
