import { RetrievalBench } from "../src/core/retrieval/eval/RetrievalBench.js";
import { RetrievalEngine } from "../src/core/retrieval/engine/RetrievalEngine.js";
import { StructuredTurnMemory } from "../src/core/memory.js";
import { InMemoryTranslationCache } from "../src/core/cache.js";
import { createSessionRefs } from "../src/core/dispatcherPipeline/sessionRefs.js";
import { NarrativeMemory } from "../src/core/narrativeMemory.js";
import type { NarrativeMemoryLike } from "../src/core/contracts.js";

async function main() {
  const memory = new StructuredTurnMemory();
  memory.addTurn({ role: "user", text: "Valeo requested a status review in Teams", source: "fixture" });
  memory.addTurn({ role: "assistant", text: "Reviewed Hoplite follow-ups and KSM planning notes", source: "fixture" });

  const narrative = new NarrativeMemory("./data/retrieval-bench-fixture.jsonl");
  narrative.entries = [
    {
      timestamp: new Date().toISOString(),
      day: new Date().toISOString().slice(0, 10),
      kind: "summary",
      text: "Teams review flagged Valeo and KSM as active contexts",
      metadata: { source: "fixture" }
    }
  ];
  narrative.loaded = true;

  const engine = new RetrievalEngine({
    memory,
    cache: new InMemoryTranslationCache(),
    sessionRefs: createSessionRefs(),
    narrativeMemory: narrative as unknown as NarrativeMemoryLike,
    retrievalConfig: { maxItems: 8, tokenBudget: 1200 }
  });

  const bench = new RetrievalBench(engine, [
    {
      id: "exact-followup",
      prompt: "what did Valeo want?",
      expectedSources: ["structured-memory", "narrative-memory"],
      expectedEntities: ["Valeo"]
    },
    {
      id: "context-review",
      prompt: "review followups for KSM",
      expectedSources: ["structured-memory", "narrative-memory"],
      expectedEntities: ["KSM"]
    },
    {
      id: "timeline-review",
      prompt: "did i miss anything in teams today?",
      expectedSources: ["session-refs", "narrative-memory"]
    }
  ]);

  const results = await bench.run();
  const summary = results.map(({ id, result }) => ({
    id,
    intent: result.plan.intent,
    sources: result.plan.sources,
    entities: result.plan.entities,
    selected: result.selectedEvidence.slice(0, 3).map((item) => ({
      id: item.id,
      source: item.sourceType,
      title: item.title ?? item.snippet.slice(0, 60),
      score: item.score ?? null
    }))
  }));

  console.log(JSON.stringify({ cases: summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
