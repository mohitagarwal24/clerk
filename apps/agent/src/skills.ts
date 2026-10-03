// The company playbook: one markdown file per procedure or policy. The model sees the index
// (frontmatter only) and loads full text on demand, so context stays small as the playbook grows.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PLAYBOOK_DIR } from "./config.js";

/** `rule` is an optional one-line summary for people (the console); the model uses `description`. */
export type Skill = { name: string; description: string; rule?: string; appliesTo: string[]; body: string };

export function parseSkill(text: string): Skill {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error("Skill file is missing frontmatter");
  const meta: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const appliesTo = (meta.applies_to ?? "").replace(/^\[|\]$/g, "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!meta.name || !meta.description) throw new Error("Skill frontmatter needs name and description");
  return { name: meta.name, description: meta.description, rule: meta.rule, appliesTo, body: m[2]!.trim() };
}

export function loadPlaybook(dir = PLAYBOOK_DIR): Skill[] {
  return readdirSync(dir).filter((f) => f.endsWith(".md")).sort()
    .map((f) => parseSkill(readFileSync(join(dir, f), "utf8")));
}

export function skillIndex(skills: Skill[]): string {
  return skills.map((s) => `- ${s.name}: ${s.description} (applies to: ${s.appliesTo.join(", ")})`).join("\n");
}

export function skillText(skills: Skill[], names: string[]): string {
  return skills.filter((s) => names.includes(s.name)).map((s) => `<skill name="${s.name}">\n${s.body}\n</skill>`).join("\n\n");
}
