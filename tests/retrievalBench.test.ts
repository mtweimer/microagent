import test from "node:test";
import assert from "node:assert/strict";

import { RetrievalBench } from "../src/core/retrieval/eval/RetrievalBench.js";
import { benchmarkCases } from "../src/core/retrieval/eval/benchmarkCases.js";
import type { RetrievalResult } from "../src/core/contracts.js";

class FakeEngine {
  async retrieve({ input }: { input: string }): Promise<RetrievalResult> {
    return {
      plan: {
        intent: input.includes("compare") ? "comparative" : "contextual",
        query: input,
        entities: input.includes("Valeo") ? ["Valeo"] : [],
        sources: ["structured-memory", "narrative-memory", ...(input.includes("Valeo") ? ["entity-graph"] : [])],
        traversalMode: "none",
        maxItems: 8,
        maxDepth: 1,
        tokenBudget: 1200
      },
      selectedEvidence: [
        {
          id: "e1",
          source: "structured-memory",
          sourceType: "structured-memory",
          title: input.includes("company") ? "user turn" : "Valeo summary",
          snippet: "fixture"
        }
      ],
      overflowEvidence: [],
      packs: { answerPack: [], reasoningPack: [], followupPack: [] },
      trace: {
        gatherers: [],
        latencyMsByGatherer: {},
        countsBySource: {},
        selectedIds: [],
        overflowIds: [],
        selectionReasonById: {},
        tokenContributionBySource: {},
        scoreBreakdownById: {}
      }
    };
  }
}

test("retrieval bench evaluates benchmark expectations", async () => {
  const bench = new RetrievalBench(
    new FakeEngine() as never,
    benchmarkCases.filter((benchCase) => benchCase.id === "review-client")
  );

  const [result] = await bench.run();
  assert.equal(result?.id, "review-client");
  assert.equal(result?.checks.intent, true);
  assert.equal(result?.checks.entities, true);
  assert.equal(result?.checks.sources, true);
});
