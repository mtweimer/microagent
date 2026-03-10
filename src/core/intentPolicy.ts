const ACTION_PREFIXES = [
  "schedule",
  "create",
  "set up",
  "set",
  "find",
  "fetch",
  "retrieve",
  "search",
  "show",
  "list",
  "review",
  "examine",
  "summarize",
  "summarise",
  "what",
  "whats",
  "what's",
  "get",
  "latest",
  "send",
  "reply",
  "email",
  "draft",
  "compose",
  "check"
];

const MEMORY_VERBS = [
  "sent",
  "emailed",
  "discussed",
  "met",
  "reviewed",
  "planned",
  "decided",
  "mentioned",
  "shared",
  "told"
];

export type IntentClassification =
  | { type: "action"; reason: string }
  | { type: "memory_statement"; reason: string }
  | { type: "clarify"; reason: string };

export function classifyIntent(input: string, domain: string | null): IntentClassification {
  if (!domain) return { type: "clarify", reason: "no_domain" };

  const text = String(input ?? "").trim();
  const lower = text.toLowerCase();

  if (isActionLike(lower)) {
    return { type: "action", reason: "imperative_or_query" };
  }

  if (isMemoryStatement(text, lower)) {
    return { type: "memory_statement", reason: "declarative_past_tense" };
  }

  return { type: "clarify", reason: "ambiguous" };
}

function isActionLike(lower: string): boolean {
  if (!lower) return false;
  if (lower.includes("?")) return true;
  return ACTION_PREFIXES.some((prefix) => lower.startsWith(`${prefix} `) || lower === prefix);
}

function isMemoryStatement(text: string, lower: string): boolean {
  if (!lower) return false;
  if (lower.includes("?")) return false;
  const startsDeclarative =
    /^(i|we|he|she|they|it|[a-z]+)\b/i.test(text) && !/^(please|can you|could you)\b/i.test(lower);
  const hasPastVerb = MEMORY_VERBS.some((verb) => lower.includes(` ${verb} `) || lower.endsWith(` ${verb}`));
  return startsDeclarative && hasPastVerb;
}
