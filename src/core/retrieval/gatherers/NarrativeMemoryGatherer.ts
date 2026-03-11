import type { NarrativeMemoryLike, RetrievalPlan, RetrievedEvidence, AnyRecord } from "../../contracts.js";
import type { Gatherer } from "./Gatherer.js";

function tokenize(text: string): string[] {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9@._-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function lexicalOverlap(plan: RetrievalPlan, text: string): number {
  const queryTerms = new Set(tokenize(plan.query));
  if (queryTerms.size === 0) return 0;
  let hits = 0;
  for (const token of tokenize(text)) {
    if (queryTerms.has(token)) hits += 1;
  }
  return hits / queryTerms.size;
}

function isTeamsPrompt(plan: RetrievalPlan): boolean {
  return /\bteams\b|\bchat\b|\bchannel\b|\bthread\b/i.test(plan.query);
}

function isRelevant(plan: RetrievalPlan, row: AnyRecord): boolean {
  const text = String(row.text ?? "");
  const overlap = lexicalOverlap(plan, text);
  if (plan.intent === "exact") {
    return overlap > 0 || plan.entities.some((entity) => text.toLowerCase().includes(entity.toLowerCase()));
  }
  if (plan.intent === "timeline" && isTeamsPrompt(plan)) {
    return /\bteams\b|\bchat\b|\bchannel\b|\bthread\b/i.test(text) || overlap >= 0.2;
  }
  if (plan.intent === "timeline") return overlap >= 0.15;
  return true;
}

export class NarrativeMemoryGatherer implements Gatherer {
  name = "narrative-memory";
  narrativeMemory: NarrativeMemoryLike;

  constructor(narrativeMemory: NarrativeMemoryLike) {
    this.narrativeMemory = narrativeMemory;
  }

  supports(plan: RetrievalPlan): boolean {
    return plan.sources.includes(this.name);
  }

  async gather(plan: RetrievalPlan): Promise<RetrievedEvidence[]> {
    const range = plan.intent === "timeline" ? "week" : "today";
    const rows = this.narrativeMemory
      .summarize(range, Math.max(4, Math.min(8, plan.maxItems)))
      .filter((row: AnyRecord) => isRelevant(plan, row));
    return rows.map((row: AnyRecord, index) => ({
      id: `narrative:${index}:${String(row.timestamp ?? row.day ?? index)}`,
      source: this.name,
      sourceType: "narrative-memory" as const,
      title: typeof row.kind === "string" ? row.kind : "narrative summary",
      snippet: String(row.text ?? ""),
      raw: row,
      ...(typeof row.timestamp === "string" ? { timestamp: row.timestamp } : {}),
      tokenCostEstimate: Math.max(20, Math.ceil(String(row.text ?? "").length / 4)),
      provenance: { query: plan.query, gatheredBy: this.name }
    }));
  }
}
