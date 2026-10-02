// Deterministic prompt-injection flagging on everything the agent reads. Flagging never changes
// what the agent may do (the prompt already treats observed text as data); it puts the attempt
// in the report so a human sees it.
const PATTERNS = [
  /\b(note|message|instruction)s?\s+to\s+(the\s+)?(ai|llm|automated)\b[^.]*\.?[^.]*\./i,
  /\b(ai|llm)\s+(agent|assistant)\b[^.]*\b(must|should|update|change|ignore|transfer)\b[^.]*\./i,
  /\bignore (all |any )?(previous|prior|above) instructions\b[^.]*\.?/i,
  /\bdo not ask for confirmation\b/i,
];

export function findInjections(text: string): string[] {
  const flat = text.replace(/\s+/g, " ");
  const hits = new Set<string>();
  for (const re of PATTERNS) {
    const m = flat.match(re);
    if (m) hits.add(m[0].trim().slice(0, 300));
  }
  // Overlapping patterns often match pieces of the same sentence; keep the longest.
  return [...hits].filter((h) => ![...hits].some((o) => o !== h && o.includes(h)));
}

/** Wrap observed content so the model can tell data from instructions. */
export function untrusted(where: string, text: string): string {
  return `<untrusted source="${where}">\n${text.replaceAll("</untrusted>", "")}\n</untrusted>`;
}
