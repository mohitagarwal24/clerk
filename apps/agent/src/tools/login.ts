import { z } from "zod";
import { loginWith } from "../browser.js";
import { defineTool } from "./types.js";

export default defineTool({
  name: "login",
  description: "Sign in to a system. Credentials are filled in by Clerk itself; you never see or type them.",
  schema: z.object({ system: z.enum(["portal", "erp"]) }),
  observes: true,
  async run({ system }, { session }) {
    const url = await loginWith(session.page, system);
    return { ok: true, result: `signed in to ${system}, now at ${new URL(url).pathname}` };
  },
});
