import type { RetrievalPlan, RetrievedEvidence, AnyRecord } from "../../contracts.js";

function tokenize(text: string): string[] {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9@._-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function lexicalOverlap(plan: RetrievalPlan, row: RetrievedEvidence): number {
  const queryTerms = new Set(tokenize(plan.query));
  if (queryTerms.size === 0) return 0;
  const haystack = tokenize(`${row.title ?? ""} ${row.snippet}`);
  let hits = 0;
  for (const token of haystack) {
    if (queryTerms.has(token)) hits += 1;
  }
  return hits / queryTerms.size;
}

function isRecentQuery(plan: RetrievalPlan): boolean {
  return /\b(today|yesterday|recent|latest|last|this week|now)\b/i.test(plan.query);
}

function entityBoost(plan: RetrievalPlan, row: RetrievedEvidence): number {
  const refs = new Set((row.entityRefs ?? []).map((value) => String(value).toLowerCase()));
  let boost = 0;
  for (const entity of plan.entities) {
    if (refs.has(entity.toLowerCase())) boost += 0.5;
    if ((row.title ?? "").toLowerCase().includes(entity.toLowerCase())) boost += 0.35;
    if (row.snippet.toLowerCase().includes(entity.toLowerCase())) boost += 0.2;
  }
  return boost;
}

function exactnessBoost(plan: RetrievalPlan, row: RetrievedEvidence): number {
  const query = String(plan.query ?? "").toLowerCase().trim();
  const title = String(row.title ?? "").toLowerCase();
  const snippet = String(row.snippet ?? "").toLowerCase();
  let boost = 0;
  if (!query) return boost;
  if (title.includes(query)) boost += 0.7;
  if (snippet.includes(query)) boost += 0.35;
  for (const entity of plan.entities) {
    const lowerEntity = entity.toLowerCase();
    if (title === lowerEntity || title.includes(lowerEntity)) boost += 0.4;
    if (snippet.includes(lowerEntity)) boost += 0.15;
  }
  if (plan.intent === "exact" && (row.sourceType === "teams-index" || row.sourceType === "session-ref")) boost += 0.2;
  return boost;
}

function continuityBoost(plan: RetrievalPlan, row: RetrievedEvidence): number {
  const query = String(plan.query ?? "").toLowerCase();
  if (row.sourceType !== "session-ref") return 0;
  if (/\b(respond|important)\b/.test(query)) return 0.9;
  return /\b(that|it|they|thread|email)\b/.test(query) ? 0.55 : 0;
}

function artifactSpecificityBoost(plan: RetrievalPlan, row: RetrievedEvidence): number {
  if (plan.intent === "timeline" && row.sourceType === "session-ref") return -0.35;
  if (plan.intent !== "exact" && plan.intent !== "lookup") return 0;
  switch (row.sourceType) {
    case "teams-index":
      return row.provenance?.externalId ? 0.45 : 0.25;
    case "session-ref":
      return 0.4;
    case "structured-memory":
      return /\b(user|assistant) turn\b/i.test(String(row.title ?? "")) ? 0.12 : 0.2;
    case "cache":
      return 0.08;
    default:
      return 0;
  }
}

function intentSourceBoost(plan: RetrievalPlan, row: RetrievedEvidence): number {
  const query = String(plan.query ?? "").toLowerCase();
  if (plan.intent === "timeline" && row.sourceType === "teams-index" && query.includes("teams")) return 0.5;
  if (plan.intent === "timeline" && row.sourceType === "session-ref" && /\bmiss anything\b/.test(query)) return -0.35;
  if (row.sourceType === "cache" && /\b(again|repeat|same|previous|last time)\b/.test(query)) return 0.8;
  return 0;
}

function recencyScore(plan: RetrievalPlan, timestamp?: string): number {
  if (!timestamp) return 0;
  const millis = new Date(timestamp).getTime();
  if (Number.isNaN(millis)) return 0;
  const ageDays = (Date.now() - millis) / (24 * 60 * 60 * 1000);
  if (plan.intent === "timeline" || isRecentQuery(plan)) {
    if (ageDays <= 1) return 0.8;
    if (ageDays <= 7) return 0.45;
    if (ageDays <= 30) return 0.15;
    return -0.05;
  }
  if (ageDays <= 1) return 0.35;
  if (ageDays <= 7) return 0.2;
  if (ageDays <= 30) return 0.08;
  return 0;
}

function sourceWeight(plan: RetrievalPlan, sourceType: string): number {
  switch (sourceType) {
    case "session-ref":
      return plan.intent === "exact" ? 0.85 : plan.intent === "timeline" ? 0.2 : 0.55;
    case "teams-index":
      return plan.intent === "exact" || plan.intent === "timeline" ? 0.8 : 0.62;
    case "entity-graph":
      return plan.intent === "comparative" ? 0.75 : plan.intent === "contextual" ? 0.58 : plan.intent === "lookup" ? 0.3 : 0.42;
    case "structured-memory":
      return plan.intent === "contextual" ? 0.65 : 0.52;
    case "narrative-memory":
      return plan.intent === "timeline" || plan.intent === "contextual" ? 0.5 : 0.18;
    case "cache":
      return /\b(again|repeat|same|previous|last time)\b/i.test(plan.query) ? 0.62 : 0.12;
    default:
      return 0.2;
  }
}

function automationPenalty(plan: RetrievalPlan, row: RetrievedEvidence): number {
  const text = `${row.title ?? ""} ${row.snippet}`.toLowerCase();
  const penalty = /\b(workflows|notifications?@|noreply|do not reply|automated)\b/.test(text) ? -0.25 : 0;
  if (penalty === 0) return 0;
  return plan.intent === "exact" && lexicalOverlap(plan, row) > 0.75 ? -0.1 : penalty;
}

function genericSummaryPenalty(plan: RetrievalPlan, row: RetrievedEvidence): number {
  const text = `${row.title ?? ""} ${row.snippet}`.toLowerCase();
  if ((plan.intent === "exact" || plan.intent === "lookup") && /\b(summary|reviewed|communications|notes)\b/.test(text)) {
    return -0.18;
  }
  return 0;
}

export class Ranker {
  rank(plan: RetrievalPlan, rows: RetrievedEvidence[]): { ranked: RetrievedEvidence[]; scoreBreakdownById: Record<string, AnyRecord> } {
    const scoreBreakdownById: Record<string, AnyRecord> = {};
    const ranked = rows
      .map((row) => {
        const breakdown = {
          lexical: lexicalOverlap(plan, row),
          entity: entityBoost(plan, row),
          exactness: exactnessBoost(plan, row),
          continuity: continuityBoost(plan, row),
          artifactSpecificity: artifactSpecificityBoost(plan, row),
          intentSource: intentSourceBoost(plan, row),
          recency: recencyScore(plan, row.timestamp),
          source: sourceWeight(plan, row.sourceType),
          automationPenalty: automationPenalty(plan, row),
          genericSummaryPenalty: genericSummaryPenalty(plan, row)
        };
        const score =
          breakdown.lexical +
          breakdown.entity +
          breakdown.exactness +
          breakdown.continuity +
          breakdown.artifactSpecificity +
          breakdown.intentSource +
          breakdown.recency +
          breakdown.source +
          breakdown.automationPenalty +
          breakdown.genericSummaryPenalty;
        scoreBreakdownById[row.id] = breakdown;
        return { ...row, score };
      })
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || String(b.timestamp ?? "").localeCompare(String(a.timestamp ?? "")) || a.id.localeCompare(b.id));
    return { ranked, scoreBreakdownById };
  }
}
