import { z } from "zod";
import { defineTool } from "./types.js";

export default defineTool({
  name: "ask_user",
  description: "Ask the human a question and wait for the answer. Use when the request is ambiguous or a policy requires confirmation. Offer options when you can.",
  schema: z.object({ question: z.string(), options: z.array(z.string()).optional() }),
  observes: false,
  async run({ question, options }, { ask, state }) {
    const answer = await ask({ question, options });
    state.facts[`user_answer_${state.questions.length}`] = `Q: ${question} A: ${answer}`;
    return { ok: true, result: `user answered: ${answer}` };
  },
});
