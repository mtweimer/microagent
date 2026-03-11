import test from "node:test";
import assert from "node:assert/strict";

import { RetrievalPlanner } from "../src/core/retrieval/planner/RetrievalPlanner.js";
import { Ranker } from "../src/core/retrieval/ranking/Ranker.js";
import { DiversityPolicy } from "../src/core/retrieval/ranking/DiversityPolicy.js";
import { ContextPacker } from "../src/core/retrieval/packing/ContextPacker.js";
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

test("retrieval planner narrows exact artifact lookups to artifact-heavy sources", () => {
  const planner = new RetrievalPlanner();
  const plan = planner.plan({
    input: "what happened in the Valeo Teams thread?",
    routeDecision: {
      mode: "retrieval",
      domain: "teams",
      actionHint: "read_message",
      confidence: 1,
      needsClarification: false,
      clarificationQuestion: null,
      unsupportedReason: null
    },
    sessionRefs: createSessionRefs(),
    retrievalConfig: {}
  });

  assert.equal(plan.intent, "exact");
  assert.deepEqual(plan.sources.slice(0, 2), ["session-refs", "teams-index"]);
  assert.equal(plan.sources.includes("structured-memory"), true);
  assert.equal(plan.sources.includes("entity-graph"), true);
  assert.equal(plan.sources.includes("narrative-memory"), false);
});

test("retrieval planner uses teams index for entity-only request prompts", () => {
  const planner = new RetrievalPlanner();
  const plan = planner.plan({
    input: "what did Valeo want?",
    routeDecision: {
      mode: "chat",
      domain: null,
      actionHint: null,
      confidence: 0.8,
      needsClarification: false,
      clarificationQuestion: null,
      unsupportedReason: null
    },
    sessionRefs: createSessionRefs(),
    retrievalConfig: {}
  });

  assert.equal(plan.intent, "exact");
  assert.equal(plan.sources.includes("teams-index"), true);
  assert.equal(plan.sources.includes("entity-graph"), true);
});

test("retrieval planner gives contextual reviews broader narrative/entity coverage", () => {
  const planner = new RetrievalPlanner();
  const plan = planner.plan({
    input: "review followups for Valeo",
    routeDecision: {
      mode: "retrieval",
      domain: "outlook",
      actionHint: "review_followups",
      confidence: 1,
      needsClarification: false,
      clarificationQuestion: null,
      unsupportedReason: null
    },
    sessionRefs: createSessionRefs(),
    retrievalConfig: {}
  });

  assert.equal(plan.intent, "contextual");
  assert.equal(plan.sources.includes("structured-memory"), true);
  assert.equal(plan.sources.includes("narrative-memory"), true);
  assert.equal(plan.sources.includes("entity-graph"), true);
});

test("retrieval planner gives timeline prompts timestamp-aware sources", () => {
  const planner = new RetrievalPlanner();
  const plan = planner.plan({
    input: "what changed in Teams this week for KSM?",
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
  assert.equal(plan.sources.includes("session-refs"), true);
  assert.equal(plan.sources.includes("narrative-memory"), true);
  assert.equal(plan.sources.includes("teams-index"), true);
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

test("ranker favors exact artifacts over broad summaries for exact queries", () => {
  const ranker = new Ranker();
  const exactArtifact: RetrievedEvidence = {
    id: "teams-artifact",
    source: "teams-index",
    sourceType: "teams-index",
    title: "Valeo status thread",
    snippet: "Valeo asked for blockers and next steps.",
    entityRefs: ["Valeo"],
    timestamp: new Date().toISOString(),
    provenance: { externalId: "teams-1" }
  };
  const narrativeSummary: RetrievedEvidence = {
    id: "narrative-summary",
    source: "narrative-memory",
    sourceType: "narrative-memory",
    title: "Reviewed Valeo communications",
    snippet: "Summary of the Valeo thread and related followups.",
    entityRefs: ["Valeo"],
    timestamp: new Date().toISOString()
  };
  const ranked = ranker.rank(makePlan({ intent: "exact", sources: ["teams-index", "narrative-memory"] }), [
    narrativeSummary,
    exactArtifact
  ]).ranked;
  assert.equal(ranked[0]?.id, "teams-artifact");
});

test("ranker does not let cache outrank stronger exact evidence by default", () => {
  const ranker = new Ranker();
  const strongMemory: RetrievedEvidence = {
    id: "memory-strong",
    source: "structured-memory",
    sourceType: "structured-memory",
    title: "user turn",
    snippet: "Valeo requested a status update and next steps.",
    entityRefs: ["Valeo"],
    timestamp: new Date().toISOString()
  };
  const cached: RetrievedEvidence = {
    id: "cache-weak",
    source: "cache",
    sourceType: "cache",
    title: "Cached lookup",
    snippet: "Found cached result for Valeo.",
    timestamp: new Date().toISOString()
  };
  const ranked = ranker.rank(makePlan({ intent: "exact", query: "what did Valeo want?" }), [cached, strongMemory]).ranked;
  assert.equal(ranked[0]?.id, "memory-strong");
});

test("ranker penalizes prompt-echo memory turns for exact followups", () => {
  const ranker = new Ranker();
  const promptEcho: RetrievedEvidence = {
    id: "memory-echo",
    source: "structured-memory",
    sourceType: "structured-memory",
    title: "user turn",
    snippet: "what did valeo want?",
    timestamp: new Date().toISOString()
  };
  const exactArtifact: RetrievedEvidence = {
    id: "teams-artifact",
    source: "teams-index",
    sourceType: "teams-index",
    title: "Valeo request thread",
    snippet: "Valeo asked for the latest testing timeline and blockers.",
    entityRefs: ["Valeo"],
    timestamp: new Date().toISOString(),
    provenance: { externalId: "teams-1" }
  };
  const ranked = ranker.rank(makePlan({ intent: "exact", query: "what did Valeo want?" }), [promptEcho, exactArtifact]).ranked;
  assert.equal(ranked[0]?.id, "teams-artifact");
});

test("ranker prefers fresher exact evidence for recent timeline prompts", () => {
  const ranker = new Ranker();
  const fresh: RetrievedEvidence = {
    id: "fresh",
    source: "teams-index",
    sourceType: "teams-index",
    title: "Valeo update today",
    snippet: "Valeo asked for an updated timeline today.",
    timestamp: new Date().toISOString(),
    entityRefs: ["Valeo"]
  };
  const stale: RetrievedEvidence = {
    id: "stale",
    source: "structured-memory",
    sourceType: "structured-memory",
    title: "user turn",
    snippet: "Valeo update from last month.",
    timestamp: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    entityRefs: ["Valeo"]
  };
  const ranked = ranker.rank(makePlan({ intent: "timeline", query: "what changed for Valeo today?" }), [stale, fresh]).ranked;
  assert.equal(ranked[0]?.id, "fresh");
});

test("diversity policy caps single-source domination while allowing stronger top results", () => {
  const policy = new DiversityPolicy(2);
  const rows: RetrievedEvidence[] = [0, 1, 2, 3].map((value) => ({
    id: `teams-${value}`,
    source: "teams-index",
    sourceType: "teams-index",
    title: `hit ${value}`,
    snippet: `snippet ${value}`,
    score: value === 0 ? 5 : 1
  }));
  const selected = policy.apply(makePlan({ intent: "exact" }), rows);
  assert.equal(selected.length >= 2, true);
  assert.equal(selected[0]?.id, "teams-0");
});

test("context packer keeps exact queries artifact-heavy and preserves overflow for followups", () => {
  const packer = new ContextPacker();
  const rows: RetrievedEvidence[] = Array.from({ length: 7 }, (_, index) => ({
    id: `item-${index}`,
    source: index < 4 ? "teams-index" : "structured-memory",
    sourceType: index < 4 ? "teams-index" : "structured-memory",
    title: `Title ${index}`,
    snippet: `Snippet ${index}`,
    score: 10 - index,
    tokenCostEstimate: 40
  }));
  const packed = packer.pack(
    makePlan({ intent: "exact", maxItems: 6, tokenBudget: 180 }),
    rows,
    {
      gatherers: ["teams-index"],
      latencyMsByGatherer: { "teams-index": 1 },
      countsBySource: { "teams-index": 4, "structured-memory": 3 },
      scoreBreakdownById: {}
    }
  );
  assert.equal(packed.packs.answerPack.length <= 4, true);
  assert.equal(packed.overflowEvidence.length > 0, true);
  assert.equal(Boolean(packed.trace.selectionReasonById["item-0"]), true);
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
    input: "search my email for invoices again",
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
    sessionRefs: {
      ...createSessionRefs(),
      outlook: { lastEmailId: null, lastEmailIds: [] }
    },
    retrievalConfig: {}
  });

  const result = await engine.retrieve({
    input: "search my email for invoices again",
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

  assert.equal(
    [...result.selectedEvidence, ...result.overflowEvidence].some((item) => item.sourceType === "cache"),
    true
  );
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

test("retrieval engine filters prompt-echo memory turns from exact lookups", async () => {
  const memory = new StructuredTurnMemory();
  memory.addTurn({ role: "user", text: "what did valeo want?", source: "cli" });
  memory.addTurn({ role: "assistant", text: "You're asking what Valeo wanted. Can you clarify?", source: "dispatcher" });
  memory.addTurn({ role: "user", text: "Valeo asked for the updated timeline and blockers.", source: "cli" });
  const engine = new RetrievalEngine({
    memory,
    cache: new InMemoryTranslationCache(),
    sessionRefs: createSessionRefs(),
    retrievalConfig: {}
  });

  const result = await engine.retrieve({ input: "what did Valeo want?" });
  assert.equal(result.selectedEvidence.some((item) => item.snippet.toLowerCase() === "what did valeo want?"), false);
  assert.equal(result.selectedEvidence.some((item) => item.snippet.includes("updated timeline and blockers")), true);
});
