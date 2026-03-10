import type { EntityGraphLike, RetrievalPlan, RetrievedEvidence } from "../../contracts.js";
import type { Gatherer } from "./Gatherer.js";

export class EntityGraphGatherer implements Gatherer {
  name = "entity-graph";
  entityGraph: EntityGraphLike;

  constructor(entityGraph: EntityGraphLike) {
    this.entityGraph = entityGraph;
  }

  supports(plan: RetrievalPlan): boolean {
    return plan.sources.includes(this.name) && typeof this.entityGraph.lookup === "function";
  }

  async gather(plan: RetrievalPlan): Promise<RetrievedEvidence[]> {
    const names = plan.entities.length > 0 ? plan.entities : [plan.query];
    const evidence: RetrievedEvidence[] = [];
    for (const name of names.slice(0, 4)) {
      const lookup = this.entityGraph.lookup?.(name, 5);
      for (const entity of lookup?.entities ?? []) {
        evidence.push({
          id: `entity:${entity.entityId}`,
          source: this.name,
          sourceType: "entity-graph",
          title: entity.name,
          snippet: `${entity.entityType} with ${entity.mentions.length} linked artifacts`,
          raw: entity,
          confidence: entity.confidence,
          entityRefs: [entity.name],
          tokenCostEstimate: 32,
          provenance: { query: name, externalId: String(entity.entityId), gatheredBy: this.name }
        });
        for (const mention of entity.mentions.slice(0, 3)) {
          evidence.push({
            id: `entity-mention:${entity.entityId}:${String(mention.artifactId)}`,
            source: this.name,
            sourceType: "entity-graph",
            title: entity.name,
            snippet: String(mention.summary ?? `${mention.domain} mention`),
            raw: mention,
            ...(typeof mention.timestamp === "string" ? { timestamp: mention.timestamp } : {}),
            entityRefs: [entity.name],
            tokenCostEstimate: 28,
            provenance: { externalId: String(mention.artifactId), query: name, gatheredBy: this.name }
          });
        }
      }
    }
    return evidence;
  }
}
