import type { RetrievalPlan, RetrievedEvidence, TranslationCache, DispatcherResponse } from "../../contracts.js";
import type { Gatherer } from "./Gatherer.js";

export class CacheGatherer implements Gatherer {
  name = "cache";
  cache: TranslationCache;
  cacheKey: string;

  constructor(cache: TranslationCache, cacheKey: string) {
    this.cache = cache;
    this.cacheKey = cacheKey;
  }

  supports(plan: RetrievalPlan): boolean {
    return plan.sources.includes(this.name);
  }

  async gather(plan: RetrievalPlan): Promise<RetrievedEvidence[]> {
    const cached = this.cache.get(this.cacheKey) as DispatcherResponse | null;
    if (!cached) return [];
    return [
      {
        id: `cache:${cached.requestId}`,
        source: this.name,
        sourceType: "cache",
        title: cached.message,
        snippet: String(cached.finalText ?? cached.message ?? ""),
        raw: cached,
        tokenCostEstimate: Math.max(20, Math.ceil(String(cached.finalText ?? cached.message ?? "").length / 4)),
        provenance: { externalId: cached.requestId, query: plan.query, gatheredBy: this.name }
      }
    ];
  }
}
