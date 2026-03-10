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

function recencyScore(timestamp?: string): number {
  if (!timestamp) return 0;
  const millis = new Date(timestamp).getTime();
  if (Number.isNaN(millis)) return 0;
  const ageDays = (Date.now() - millis) / (24 * 60 * 60 * 1000);
  if (ageDays <= 1) return 0.45;
  if (ageDays <= 7) return 0.25;
  if (ageDays <= 30) return 0.1;
  return 0;
}

function sourceWeight(sourceType: string): number {
  switch (sourceType) {
    case "session-ref":
      return 0.7;
    case "teams-index":
      return 0.6;
    case "entity-graph":
      return 0.55;
    case "structured-memory":
      return 0.5;
    case "narrative-memory":
      return 0.35;
    case "cache":
      return 0.25;
    default:
      return 0.2;
  }
}

function automationPenalty(row: RetrievedEvidence): number {
  const text = `${row.title ?? ""} ${row.snippet}`.toLowerCase();
  return /\b(workflows|notifications?@|noreply|do not reply|automated)\b/.test(text) ? -0.25 : 0;
}

export class Ranker {
  rank(plan: RetrievalPlan, rows: RetrievedEvidence[]): { ranked: RetrievedEvidence[]; scoreBreakdownById: Record<string, AnyRecord> } {
    const scoreBreakdownById: Record<string, AnyRecord> = {};
    const ranked = rows
      .map((row) => {
        const breakdown = {
          lexical: lexicalOverlap(plan, row),
          entity: entityBoost(plan, row),
          recency: recencyScore(row.timestamp),
          source: sourceWeight(row.sourceType),
          automationPenalty: automationPenalty(row)
        };
        const score = breakdown.lexical + breakdown.entity + breakdown.recency + breakdown.source + breakdown.automationPenalty;
        scoreBreakdownById[row.id] = breakdown;
        return { ...row, score };
      })
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || String(b.timestamp ?? "").localeCompare(String(a.timestamp ?? "")) || a.id.localeCompare(b.id));
    return { ranked, scoreBreakdownById };
  }
}
