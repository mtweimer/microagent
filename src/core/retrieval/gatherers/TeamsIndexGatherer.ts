import crypto from "node:crypto";
import type { RetrievalPlan, RetrievedEvidence, TeamsIndexLike, AnyRecord } from "../../contracts.js";
import type { Gatherer } from "./Gatherer.js";

function asRows(value: unknown): AnyRecord[] {
  return Array.isArray(value) ? value.filter((row): row is AnyRecord => typeof row === "object" && row !== null) : [];
}

export class TeamsIndexGatherer implements Gatherer {
  name = "teams-index";
  teamsIndex: TeamsIndexLike;

  constructor(teamsIndex: TeamsIndexLike) {
    this.teamsIndex = teamsIndex;
  }

  supports(plan: RetrievalPlan): boolean {
    return plan.sources.includes(this.name) && typeof this.teamsIndex.searchMessages === "function";
  }

  async gather(plan: RetrievalPlan): Promise<RetrievedEvidence[]> {
    const raw = await this.teamsIndex.searchMessages?.({
      query: plan.query,
      top: Math.max(10, Math.min(50, plan.maxItems * 3)),
      window: plan.intent === "timeline" ? "7d" : "all",
      surface: "both",
      depth: plan.intent === "exact" ? "balanced" : "deep"
    });
    const result = typeof raw === "object" && raw !== null ? (raw as AnyRecord) : {};
    const messages = asRows(result.messages);
    const fallbacks = asRows(result.fallbackMatches);
    return [
      ...messages.map((row) => ({
        id: `teams:${String(row.id ?? row.webUrl ?? crypto.randomUUID())}`,
        source: this.name,
        sourceType: "teams-index" as const,
        title: typeof row.subject === "string" && row.subject ? row.subject : typeof row.teamName === "string" ? row.teamName : "Teams message",
        snippet: String(row.bodyPreview ?? row.summary ?? ""),
        raw: row,
        timestamp: typeof row.createdDateTime === "string" ? row.createdDateTime : undefined,
        entityRefs: [row.teamName, row.channelName, row.from].filter((value): value is string => typeof value === "string" && value.length > 0),
        tokenCostEstimate: Math.max(20, Math.ceil(String(row.bodyPreview ?? row.summary ?? "").length / 4)),
        provenance: { externalId: String(row.id ?? ""), locator: String(row.webUrl ?? ""), query: plan.query, gatheredBy: this.name }
      })),
      ...fallbacks.map((row) => ({
        id: `teams-fallback:${String(row.id ?? row.webUrl ?? crypto.randomUUID())}`,
        source: this.name,
        sourceType: "teams-index" as const,
        title: String(row.label ?? "Teams workspace match"),
        snippet: String(row.why ?? row.label ?? ""),
        raw: row,
        entityRefs: [row.teamName, row.channelName, row.label].filter((value): value is string => typeof value === "string" && value.length > 0),
        tokenCostEstimate: Math.max(16, Math.ceil(String(row.label ?? "").length / 4)),
        provenance: { externalId: String(row.id ?? ""), locator: String(row.webUrl ?? ""), query: plan.query, gatheredBy: this.name }
      }))
    ];
  }
}
