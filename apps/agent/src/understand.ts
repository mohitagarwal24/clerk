// Goal understanding + plan. Two structured calls:
//   1. pick skills: the model sees only the playbook index and names the skills it needs;
//   2. GoalSpec: request + those skills -> intent, criteria (as checks with a source), plan.
// Replanning reuses the same idea with the failure context and keeps the criteria fixed.
import { z } from "zod";
import { GoalSpec, type RunState } from "@clerk/shared";
import { structured, type LLM, type Meter } from "./llm.js";
import { type Skill, skillIndex, skillText } from "./skills.js";

const SYSTEM = `You are the planning step of Clerk, an autonomous back-office worker at Acme Corp.
You turn a user's request into a goal specification BEFORE any action is taken.
Company knowledge is in the playbook skills; follow them, they override your own assumptions.`;

const CRITERIA_GUIDE = `How to write success_criteria (they are evaluated later in code by an independent verifier):
- Write each criterion as a CHECK WITH A SOURCE, never as a value you have not seen yet.
  Values that come from a source document are written as "$source.<key>" and listed in source_fields;
  the verifier re-reads the document itself to get them.
- kind "record": rows of the ERP read-only JSON must match. Give resource, where[] and expect_count and/or expect_fields.
  bills fields: id, vendor_id, vendor_name, invoice_no, amount (e.g. 48250.00), due_date (ISO yyyy-mm-dd), status (Open|Escalated|Paid), notes, overdue (true|false)
  vendors fields: id, name, city, gstin, contact_email, bank_account, bank_ifsc
  where ops: "=" equals, "!=" not equals, "~" case-insensitive contains (use "~" for names the user gave loosely).
- kind "answer": a value the agent must report (answer_key) equals an aggregate (sum_amount or count) over ERP rows matching where[].
- kind "no_writes": nothing may be written to the ERP (read-only requests, or when policy says stop).
- kind "asked_user": the agent must ask a human before acting (ambiguity, or a policy that needs confirmation).
Example, request "Record purchase order PO-77 from Foo Ltd":
  source_fields: [{key:"po_no",description:"PO number on the selected document"},{key:"amount",description:"PO total"}]
  criteria: C1 record bills where [{field:"vendor_name",op:"~",value:"Foo"},{field:"invoice_no",op:"=",value:"$source.po_no"}] expect_count "1";
            C2 same where, expect_fields [{field:"amount",value:"$source.amount"}].
Keep criteria few (2-5) and each one checkable. Put genuine ambiguities in open_questions; do not invent answers.`;

export async function pickSkills(llm: LLM, meter: Meter, request: string, skills: Skill[]): Promise<string[]> {
  const out = await structured(llm, {
    purpose: "pick_skills",
    system: SYSTEM,
    prompt: `Request: ${request}\n\nPlaybook index:\n${skillIndex(skills)}\n\nWhich skills must be read to do this request correctly? Include any policy that could apply. Return their names.`,
    schema: z.object({ skills: z.array(z.string()) }),
  }, meter);
  const known = new Set(skills.map((s) => s.name));
  return [...new Set(out.skills.filter((n) => known.has(n)))];
}

export async function understand(llm: LLM, meter: Meter, request: string, skills: Skill[], chosen: string[]): Promise<GoalSpec> {
  return structured(llm, {
    purpose: "understand",
    system: `${SYSTEM}\n\n${CRITERIA_GUIDE}`,
    prompt: `Request: ${request}\n\nPlaybook index:\n${skillIndex(skills)}\n\nLoaded skills:\n${skillText(skills, chosen)}\n\n` +
      `Produce the goal specification: intent, entities, source_fields, success_criteria, open_questions, plan (3-8 short steps).`,
    schema: GoalSpec,
  }, meter);
}

export async function replan(llm: LLM, meter: Meter, state: RunState, skills: Skill[], reason: string): Promise<string[]> {
  const goal = state.goal!;
  const out = await structured(llm, {
    purpose: "replan",
    system: SYSTEM,
    prompt: `Request: ${state.request}\nIntent: ${goal.intent}\nSuccess criteria (fixed):\n${goal.success_criteria.map((c) => `- ${c.id}: ${c.check}`).join("\n")}\n\n` +
      `Current plan:\n${goal.plan.map((p, i) => `${i + 1}. ${p}`).join("\n")}\n\nWhy the plan no longer fits: ${reason}\n\n` +
      `Working memory:\n${Object.entries(state.facts).map(([k, v]) => `${k} = ${v}`).join("\n") || "(empty)"}\n\n` +
      `Loaded skills:\n${skillText(skills, state.skillsLoaded)}\n\nWrite the new plan from here (3-8 short steps).`,
    schema: z.object({ plan: z.array(z.string()) }),
  }, meter);
  return out.plan;
}
