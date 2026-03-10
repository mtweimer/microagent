import type { RetrievedEvidence } from "../../contracts.js";

export class DiversityPolicy {
  maxPerSource: number;

  constructor(maxPerSource = 4) {
    this.maxPerSource = maxPerSource;
  }

  apply(rows: RetrievedEvidence[]): RetrievedEvidence[] {
    const counts = new Map<string, number>();
    const selected: RetrievedEvidence[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const dedupeKey = `${row.sourceType}:${row.title ?? ""}:${row.snippet.slice(0, 120)}`;
      if (seen.has(dedupeKey)) continue;
      const nextCount = (counts.get(row.sourceType) ?? 0) + 1;
      if (nextCount > this.maxPerSource) continue;
      seen.add(dedupeKey);
      counts.set(row.sourceType, nextCount);
      selected.push(row);
    }
    return selected;
  }
}
