import type { RetrievalPlan, RetrievedEvidence } from "../../contracts.js";

export class DiversityPolicy {
  defaultMaxPerSource: number;

  constructor(maxPerSource = 4) {
    this.defaultMaxPerSource = maxPerSource;
  }

  maxPerSourceFor(plan: RetrievalPlan): number {
    switch (plan.intent) {
      case "exact":
      case "comparative":
        return 3;
      case "timeline":
        return 5;
      default:
        return this.defaultMaxPerSource;
    }
  }

  apply(plan: RetrievalPlan, rows: RetrievedEvidence[]): RetrievedEvidence[] {
    const maxPerSource = this.maxPerSourceFor(plan);
    const counts = new Map<string, number>();
    const selected: RetrievedEvidence[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const dedupeKey = `${row.sourceType}:${row.title ?? ""}:${row.snippet.slice(0, 120)}`;
      if (seen.has(dedupeKey)) continue;
      const nextCount = (counts.get(row.sourceType) ?? 0) + 1;
      if (nextCount > maxPerSource && (row.score ?? 0) < ((selected.at(-1)?.score ?? 0) + 0.25)) continue;
      seen.add(dedupeKey);
      counts.set(row.sourceType, nextCount);
      selected.push(row);
    }
    return selected;
  }
}
