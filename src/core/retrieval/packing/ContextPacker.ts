import type { RetrievalPlan, RetrievalResult, RetrievedEvidence, RetrievalTrace } from "../../contracts.js";

export class ContextPacker {
  pack(
    plan: RetrievalPlan,
    ranked: RetrievedEvidence[],
    trace: Omit<RetrievalTrace, "selectedIds" | "overflowIds" | "selectionReasonById" | "tokenContributionBySource">
  ): RetrievalResult {
    const selected: RetrievedEvidence[] = [];
    const overflow: RetrievedEvidence[] = [];
    const selectionReasonById: Record<string, string> = {};
    let used = 0;
    const maxSelectedItems =
      plan.intent === "exact"
        ? Math.min(plan.maxItems, 5)
        : plan.intent === "timeline"
          ? Math.min(plan.maxItems, 8)
          : plan.maxItems;
    for (const row of ranked) {
      const cost = row.tokenCostEstimate ?? 40;
      if (selected.length < maxSelectedItems && used + cost <= plan.tokenBudget) {
        selected.push(row);
        used += cost;
        selectionReasonById[row.id] = "selected:within_budget";
      } else {
        overflow.push(row);
        selectionReasonById[row.id] =
          selected.length >= maxSelectedItems ? "overflow:max_items" : "overflow:token_budget";
      }
    }
    const answerCount =
      plan.intent === "exact"
        ? Math.min(selected.length, 4)
        : plan.intent === "timeline"
          ? Math.min(selected.length, 3)
          : Math.min(selected.length, Math.max(3, Math.min(6, Math.ceil(plan.maxItems / 2))));
    const reasoningLimit =
      plan.intent === "exact"
        ? Math.min(selected.length - answerCount, 2)
        : Math.max(0, selected.length - answerCount);
    const answerPack = selected.slice(0, answerCount);
    const reasoningPack = selected.slice(answerCount, answerCount + reasoningLimit);
    const followupPack = overflow.slice(0, plan.intent === "exact" ? 6 : 12);
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
        selectionReasonById,
        tokenContributionBySource
      }
    };
  }
}
