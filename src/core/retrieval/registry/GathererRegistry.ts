import type { RetrievalPlan, RetrievedEvidence } from "../../contracts.js";
import type { Gatherer } from "../gatherers/Gatherer.js";

export class GathererRegistry {
  gatherers: Gatherer[];

  constructor(gatherers: Gatherer[]) {
    this.gatherers = gatherers;
  }

  supported(plan: RetrievalPlan): Gatherer[] {
    return this.gatherers.filter((gatherer) => gatherer.supports(plan));
  }

  async gatherAll(plan: RetrievalPlan): Promise<{ evidence: RetrievedEvidence[]; latencyMsByGatherer: Record<string, number> }> {
    const evidence: RetrievedEvidence[] = [];
    const latencyMsByGatherer: Record<string, number> = {};
    for (const gatherer of this.supported(plan)) {
      const start = performance.now();
      const rows = await gatherer.gather(plan);
      latencyMsByGatherer[gatherer.name] = Math.round((performance.now() - start) * 1000) / 1000;
      evidence.push(...rows);
    }
    return { evidence, latencyMsByGatherer };
  }
}
