import { z } from "zod";
import { readFile } from "node:fs/promises";
import { extractText } from "unpdf";
import { ToolInputError } from "../recovery.js";
import { defineTool } from "./types.js";

export async function pdfText(bytes: Uint8Array): Promise<string> {
  const { text } = await extractText(bytes, { mergePages: true });
  return text;
}

export default defineTool({
  name: "read_pdf",
  description: "Read the text of a PDF you downloaded earlier (pass the file name download returned). Its text then stays visible under 'Documents you have read'.",
  schema: z.object({ file: z.string().describe("e.g. INV-1042.pdf") }),
  observes: false,
  async run({ file }, { state, flagInjections }) {
    const dl = state.downloads.find((d) => d.name === file || d.path.endsWith(file));
    if (!dl) throw new ToolInputError(`No downloaded file named ${file}. Downloaded: ${state.downloads.map((d) => d.name).join(", ") || "none"}.`);
    if (state.documents.some((d) => d.name === dl.name)) {
      return { ok: true, result: `${dl.name} was already read; its text is under "Documents you have read". Use it and move on.` };
    }
    const text = await pdfText(new Uint8Array(await readFile(dl.path)));
    const flagged = flagInjections(`pdf ${dl.name}`, text).length > 0;
    state.documents.push({ name: dl.name, text, flagged });
    return { ok: true, result: `read ${dl.name} (${text.length} chars)${flagged ? ", flagged embedded instruction" : ""}; text is now under "Documents you have read"` };
  },
});
