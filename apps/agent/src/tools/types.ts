import type { z } from "zod";
import type { FinishArgs, Question, Recovery, RunState } from "@clerk/shared";
import type { BrowserSession } from "../browser.js";
import type { Emit } from "../events.js";
import type { Skill } from "../skills.js";

export type ToolContext = {
  state: RunState;
  session: BrowserSession;
  skills: Skill[];
  dir: string;
  emit: Emit;
  ask: (q: Omit<Question, "id" | "step">) => Promise<string>;
  replan: (reason: string) => Promise<string>;
  flagInjections: (where: string, text: string) => string[];
  recover: (r: Recovery) => void;
};

export type ToolResult = {
  ok: boolean;
  /** One-line result for the action log and the next prompt. */
  result: string;
  /** Longer output shown to the model once, on the next step (e.g. PDF text, skill text). */
  output?: string;
  finish?: FinishArgs;
};

export type Tool<S extends z.ZodObject = z.ZodObject> = {
  name: string;
  description: string;
  schema: S;
  /** Whether the browser is observed (snapshot + screenshot) after this tool. */
  observes: boolean;
  run: (args: z.infer<S>, ctx: ToolContext) => Promise<ToolResult>;
};

export const defineTool = <S extends z.ZodObject>(t: Tool<S>) => t as unknown as Tool;
