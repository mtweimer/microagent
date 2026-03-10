import type { NarrativeMemoryLike, RetrievalPlan, RetrievedEvidence, AnyRecord } from "../../contracts.js";
import type { Gatherer } from "./Gatherer.js";

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
    const rows = this.narrativeMemory.summarize(range, Math.max(4, Math.min(8, plan.maxItems)));
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
