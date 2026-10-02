// All tools the agent can call. Adding a tool = one file + one line here.
import { z } from "zod";
import type { ToolDecl } from "../llm.js";
import type { Tool } from "./types.js";
import open_url from "./open_url.js";
import click from "./click.js";
import type_ from "./type.js";
import select from "./select.js";
import login from "./login.js";
import download from "./download.js";
import read_pdf from "./read_pdf.js";
import read_skill from "./read_skill.js";
import remember from "./remember.js";
import ask_user from "./ask_user.js";
import replan from "./replan.js";
import finish from "./finish.js";

export const TOOLS: Tool[] = [open_url, click, type_, select, login, download, read_pdf, read_skill, remember, ask_user, replan, finish];

export const toolByName = (name: string) => TOOLS.find((t) => t.name === name);

/** Fields every call carries, so the log can say why and the plan panel can track progress. */
const COMMON = {
  why: z.string().describe("One short sentence: why this action, now"),
  plan_step: z.number().int().optional().describe("1-based number of the plan step this action works on"),
};

/** Declarations sent to the model: each tool's own schema plus the common fields. */
export function declarations(): ToolDecl[] {
  return TOOLS.map((t) => ({ name: t.name, description: t.description, schema: t.schema.extend(COMMON) }));
}
