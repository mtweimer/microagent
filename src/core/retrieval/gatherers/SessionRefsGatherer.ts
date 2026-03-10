import type { RetrievalPlan, RetrievedEvidence, SessionRefs } from "../../contracts.js";
import type { Gatherer } from "./Gatherer.js";

export class SessionRefsGatherer implements Gatherer {
  name = "session-refs";
  sessionRefs: SessionRefs;

  constructor(sessionRefs: SessionRefs) {
    this.sessionRefs = sessionRefs;
  }

  supports(plan: RetrievalPlan): boolean {
    return plan.sources.includes(this.name);
  }

  async gather(_plan: RetrievalPlan): Promise<RetrievedEvidence[]> {
    const evidence: RetrievedEvidence[] = [];
    if (this.sessionRefs.outlook.lastEmailId) {
      evidence.push({
        id: `session-ref:outlook:${this.sessionRefs.outlook.lastEmailId}`,
        source: this.name,
        sourceType: "session-ref",
        title: "Last email reference",
        snippet: `Recent Outlook email id ${this.sessionRefs.outlook.lastEmailId}`,
        entityRefs: [],
        tokenCostEstimate: 40,
        provenance: { externalId: this.sessionRefs.outlook.lastEmailId, gatheredBy: this.name }
      });
    }
    if (this.sessionRefs.teams.lastThreadId) {
      evidence.push({
        id: `session-ref:teams:${this.sessionRefs.teams.lastThreadId}`,
        source: this.name,
        sourceType: "session-ref",
        title: "Last Teams thread reference",
        snippet: `Recent Teams thread ${this.sessionRefs.teams.lastThreadId}`,
        entityRefs: [this.sessionRefs.teams.lastTeam, this.sessionRefs.teams.lastChannel].filter((v): v is string => Boolean(v)),
        tokenCostEstimate: 40,
        provenance: { externalId: this.sessionRefs.teams.lastThreadId, gatheredBy: this.name }
      });
    }
    if (this.sessionRefs.review.lastItems.length > 0) {
      for (const item of this.sessionRefs.review.lastItems.slice(0, 3)) {
        evidence.push({
          id: `session-ref:review:${item.id}`,
          source: this.name,
          sourceType: "session-ref",
          title: item.title,
          snippet: item.rationale,
          entityRefs: [],
          tokenCostEstimate: 80,
          provenance: { externalId: item.sourceArtifactId, gatheredBy: this.name }
        });
      }
    }
    return evidence;
  }
}
