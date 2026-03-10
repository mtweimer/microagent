import type { MemoryStore, RetrievalPlan, RetrievedEvidence, MemoryQueryHit } from "../../contracts.js";
import type { Gatherer } from "./Gatherer.js";

export class StructuredMemoryGatherer implements Gatherer {
  name = "structured-memory";
  memory: MemoryStore;

  constructor(memory: MemoryStore) {
    this.memory = memory;
  }

  supports(plan: RetrievalPlan): boolean {
    return plan.sources.includes(this.name);
  }

  async gather(plan: RetrievalPlan): Promise<RetrievedEvidence[]> {
    const rows = this.memory.query(plan.query, { topK: Math.max(4, Math.min(12, plan.maxItems)) }).results;
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
