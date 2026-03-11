import type { MemoryStore, RetrievalPlan, RetrievedEvidence, MemoryQueryHit } from "../../contracts.js";
import type { Gatherer } from "./Gatherer.js";

function normalize(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isPromptEcho(plan: RetrievalPlan, row: MemoryQueryHit): boolean {
  const normalizedQuery = normalize(plan.query);
  const normalizedText = normalize(String(row.text ?? ""));
  if (!normalizedQuery || !normalizedText) return false;
  if (normalizedText === normalizedQuery) return true;
  if (row.role === "assistant" && /^you(?:'|’)re asking\b/i.test(String(row.text ?? ""))) return true;
  if (row.role === "assistant" && normalizedText.includes(normalizedQuery) && normalizedText.length <= normalizedQuery.length + 120) {
    return true;
  }
  return false;
}

export class StructuredMemoryGatherer implements Gatherer {
  name = "structured-memory";
  memory: MemoryStore;
  excludeIds: Array<string | number>;

  constructor(memory: MemoryStore, excludeIds: Array<string | number> = []) {
    this.memory = memory;
    this.excludeIds = excludeIds;
  }

  supports(plan: RetrievalPlan): boolean {
    return plan.sources.includes(this.name);
  }

  async gather(plan: RetrievalPlan): Promise<RetrievedEvidence[]> {
    const rows = this.memory.query(plan.query, {
      topK: Math.max(4, Math.min(12, plan.maxItems)),
      excludeIds: this.excludeIds
    }).results.filter((row: MemoryQueryHit) => !isPromptEcho(plan, row));
    return rows.map((row: MemoryQueryHit) => ({
      id: `memory:${String(row.id)}`,
      source: this.name,
      sourceType: "structured-memory" as const,
      title: typeof row.role === "string" ? `${row.role} turn` : "memory turn",
      snippet: String(row.text ?? ""),
      raw: row,
      ...(typeof row.timestamp === "string" ? { timestamp: row.timestamp } : {}),
      tokenCostEstimate: Math.max(20, Math.ceil(String(row.text ?? "").length / 4)),
      provenance: { externalId: String(row.id), query: plan.query, gatheredBy: this.name }
    }));
  }
}
