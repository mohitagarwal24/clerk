import { z } from "zod";
import { ToolInputError } from "../recovery.js";
import { defineTool } from "./types.js";

export default defineTool({
  name: "read_skill",
  description: "Load a company playbook skill by name (see the index). Its full text stays in your context for the rest of the run.",
  schema: z.object({ name: z.string() }),
  observes: false,
  async run({ name }, { skills, state, emit }) {
    const skill = skills.find((s) => s.name === name);
    if (!skill) throw new ToolInputError(`No skill "${name}". Available: ${skills.map((s) => s.name).join(", ")}.`);
    if (!state.skillsLoaded.includes(name)) {
      state.skillsLoaded.push(name);
      emit({ type: "skill_loaded", name });
    }
    return { ok: true, result: `loaded skill ${name}` };
  },
});
