import test from "node:test";
import assert from "node:assert/strict";

import { RetrievalPlanner } from "../src/core/retrieval/planner/RetrievalPlanner.js";
import { Ranker } from "../src/core/retrieval/ranking/Ranker.js";
import { DiversityPolicy } from "../src/core/retrieval/ranking/DiversityPolicy.js";
import { RetrievalEngine } from "../src/core/retrieval/engine/RetrievalEngine.js";
import { StructuredTurnMemory } from "../src/core/memory.js";
import { InMemoryTranslationCache } from "../src/core/cache.js";
import { createSessionRefs } from "../src/core/dispatcherPipeline/sessionRefs.js";
import { NarrativeMemory } from "../src/core/narrativeMemory.js";
import { buildTranslationCacheKey } from "../src/core/cacheKey.js";
import type { NarrativeMemoryLike, RetrievalPlan, RetrievedEvidence } from "../src/core/contracts.js";

function makePlan(overrides: Partial<RetrievalPlan> = {}): RetrievalPlan {
  return {
    intent: "lookup",
    query: "valeo review",
    entities: ["Valeo"],
    sources: ["entity-graph", "teams-index", "structured-memory"],
    traversalMode: "none",
    maxItems: 8,
    maxDepth: 1,
    tokenBudget: 1000,
    ...overrides
  };
}

test("retrieval planner selects teams and entity sources for teams review", () => {
  const planner = new RetrievalPlanner();
  const plan = planner.plan({
    input: "did i miss anything in teams for Valeo today?",
    routeDecision: {
      mode: "retrieval",
      domain: "teams",
      actionHint: "review_my_day",
      confidence: 1,
      needsClarification: false,
      clarificationQuestion: null,
      unsupportedReason: null
    },
    sessionRefs: createSessionRefs(),
    retrievalConfig: {}
  });

  assert.equal(plan.intent, "timeline");
  assert.equal(plan.sources.includes("teams-index"), true);
  assert.equal(plan.sources.includes("entity-graph"), true);
});

test("ranker boosts exact entity matches over loose lexical matches", () => {
  const ranker = new Ranker();
  const exact: RetrievedEvidence = {
    id: "exact",
    source: "teams-index",
    sourceType: "teams-index",
    title: "Valeo status update",
    snippet: "Discussion with Valeo client team",
    entityRefs: ["Valeo"]
  };
  const loose: RetrievedEvidence = {
    id: "loose",
    source: "structured-memory",
    sourceType: "structured-memory",
    title: "status update",
    snippet: "general review notes"
  };
  const ranked = ranker.rank(makePlan(), [loose, exact]).ranked;
  assert.equal(ranked[0]?.id, "exact");
});

test("diversity policy caps single-source domination", () => {
  const policy = new DiversityPolicy(2);
  const rows: RetrievedEvidence[] = [0, 1, 2, 3].map((value) => ({
    id: `teams-${value}`,
    source: "teams-index",
    sourceType: "teams-index",
    title: `hit ${value}`,
    snippet: `snippet ${value}`
  }));
  const selected = policy.apply(rows);
  assert.equal(selected.length, 2);
});

test("retrieval engine gathers and packs evidence with trace", async () => {
  const memory = new StructuredTurnMemory();
  memory.addTurn({ role: "user", text: "Valeo asked for a review update", source: "cli" });
  const narrative = new NarrativeMemory("./data/test-retrieval-engine.jsonl");
  narrative.entries = [
    {
      timestamp: new Date().toISOString(),
      day: new Date().toISOString().slice(0, 10),
      kind: "summary",
      text: "Reviewed Valeo communications today",
      metadata: {}
    }
  ];
  narrative.loaded = true;
  const engine = new RetrievalEngine({
    memory,
    cache: new InMemoryTranslationCache(),
    sessionRefs: createSessionRefs(),
    narrativeMemory: narrative as unknown as NarrativeMemoryLike,
    retrievalConfig: { maxItems: 6, tokenBudget: 600 }
  });

  const result = await engine.retrieve({ input: "review Valeo communications" });
  assert.equal(result.plan.query, "review Valeo communications");
  assert.equal(result.trace.gatherers.includes("structured-memory"), true);
  assert.equal(result.packs.answerPack.length > 0 || result.packs.reasoningPack.length > 0, true);
});

test("cache gatherer uses the real dispatcher cache key path", async () => {
  const cache = new InMemoryTranslationCache();
  const key = buildTranslationCacheKey({
    input: "search my email for invoices",
    provider: "ollama",
    model: "llama3.1",
    composerConfig: {}
  });
  cache.set(key, {
    requestId: "cached-1",
    status: "ok",
    message: "Found cached result",
    finalText: "Found cached result",
    artifacts: {},
    memoryRefs: [],
    trace: {
      traceId: "t1",
      requestId: "cached-1",
      provider: "ollama",
      model: "llama3.1",
      translationSource: "cache",
      schemaVersion: "1.0.0",
      agent: "cache",
      cacheHit: true,
      stageTimingsMs: {},
      validationErrors: [],
      executionError: null,
      timestamp: new Date().toISOString()
    }
  });

  const engine = new RetrievalEngine({
    memory: new StructuredTurnMemory(),
    cache,
    getCacheKey: (input) =>
      buildTranslationCacheKey({
        input,
        provider: "ollama",
        model: "llama3.1",
        composerConfig: {}
      }),
    sessionRefs: createSessionRefs(),
    retrievalConfig: {}
  });

  const result = await engine.retrieve({
    input: "search my email for invoices",
    routeDecision: {
      mode: "retrieval",
      domain: "outlook",
      actionHint: "search_email",
      confidence: 1,
      needsClarification: false,
      clarificationQuestion: null,
      unsupportedReason: null
    }
  });

  assert.equal(result.selectedEvidence.some((item) => item.sourceType === "cache"), true);
});

test("retrieval engine can exclude current-turn assistant memory ids", async () => {
  const memory = new StructuredTurnMemory();
  memory.addTurn({ role: "user", text: "review valeo", source: "cli" });
  const assistant = memory.addTurn({
    role: "assistant",
    text: JSON.stringify({ status: "ok", message: "assistant_result", artifacts: { action: { agent: "ms.outlook" } } }),
    source: "ms.outlook"
  });
  const engine = new RetrievalEngine({
    memory,
    cache: new InMemoryTranslationCache(),
    sessionRefs: createSessionRefs(),
    retrievalConfig: {}
  });

  const result = await engine.retrieve({
    input: "review valeo",
    excludeMemoryIds: [assistant.id]
  });

  assert.equal(
    result.selectedEvidence.some((item) => item.id === `memory:${String(assistant.id)}`),
    false
  );
});
