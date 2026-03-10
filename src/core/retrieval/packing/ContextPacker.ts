import type { RetrievalPlan, RetrievalResult, RetrievedEvidence, RetrievalTrace } from "../../contracts.js";

export class ContextPacker {
  pack(plan: RetrievalPlan, ranked: RetrievedEvidence[], trace: Omit<RetrievalTrace, "selectedIds" | "overflowIds" | "tokenContributionBySource">): RetrievalResult {
    const selected: RetrievedEvidence[] = [];
    const overflow: RetrievedEvidence[] = [];
    let used = 0;
    for (const row of ranked) {
      const cost = row.tokenCostEstimate ?? 40;
      if (selected.length < plan.maxItems && used + cost <= plan.tokenBudget) {
        selected.push(row);
        used += cost;
      } else {
        overflow.push(row);
      }
    }
    const answerPack = selected.slice(0, Math.max(3, Math.min(6, Math.ceil(plan.maxItems / 2))));
    const reasoningPack = selected.slice(answerPack.length);
    const followupPack = overflow.slice(0, 10);
    const tokenContributionBySource = selected.reduce<Record<string, number>>((acc, row) => {
      acc[row.sourceType] = (acc[row.sourceType] ?? 0) + (row.tokenCostEstimate ?? 0);
      return acc;
    }, {});
    return {
      plan,
      selectedEvidence: selected,
      overflowEvidence: overflow,
      packs: {
        answerPack,
        reasoningPack,
        followupPack
      },
      trace: {
        ...trace,
        selectedIds: selected.map((row) => row.id),
        overflowIds: overflow.map((row) => row.id),
        tokenContributionBySource
      }
    };
  }
}
