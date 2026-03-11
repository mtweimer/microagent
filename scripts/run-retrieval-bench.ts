import { RetrievalBench } from "../src/core/retrieval/eval/RetrievalBench.js";
import { benchmarkCases } from "../src/core/retrieval/eval/benchmarkCases.js";
import { RetrievalEngine } from "../src/core/retrieval/engine/RetrievalEngine.js";
import { StructuredTurnMemory } from "../src/core/memory.js";
import { InMemoryTranslationCache } from "../src/core/cache.js";
import { createSessionRefs } from "../src/core/dispatcherPipeline/sessionRefs.js";
import { NarrativeMemory } from "../src/core/narrativeMemory.js";
import { buildTranslationCacheKey } from "../src/core/cacheKey.js";
import type { EntityGraphLike, NarrativeMemoryLike, SessionRefs, TeamsIndexLike } from "../src/core/contracts.js";

function createBenchSessionRefs(): SessionRefs {
  const refs = createSessionRefs();
  refs.outlook.lastEmailId = "email-valeo-1";
  refs.outlook.lastEmailIds = ["email-valeo-1", "email-ksm-1"];
  refs.teams.lastThreadId = "teams-thread-valeo";
  refs.teams.lastMessageIds = ["teams-msg-valeo-1", "teams-msg-ksm-1"];
  refs.teams.lastTeam = "Hoplite Consulting";
  refs.teams.lastChannel = "Valeo Status";
  refs.review.lastTarget = "Valeo";
  refs.review.lastItems = [
    {
      id: "review-valeo-1",
      title: "Valeo response needed",
      sourceDomain: "outlook",
      sourceArtifactId: "email-valeo-1",
      triageClass: "needs_response",
      priority: "high",
      rationale: "Client asked for a status update and next steps.",
      evidence: []
    }
  ];
  refs.entities.lastNames = ["Valeo", "KSM", "Hoplite Consulting"];
  return refs;
}

function createBenchTeamsIndex(): TeamsIndexLike {
  return {
    async searchMessages(options = {}) {
      const query = String(options.query ?? "").toLowerCase();
      const messages = [];
      const fallbackMatches = [];
      const coverage = {
        chatsScanned: 6,
        chatMessagesScanned: 0,
        channelsScanned: 12,
        channelMessagesScanned: 24,
        totalCandidates: 24
      };
      if (query.includes("valeo")) {
        messages.push({
          id: "teams-msg-valeo-1",
          subject: "Valeo launch blockers",
          bodyPreview: "Valeo asked for deployment timing, open blockers, and owners.",
          summary: "Valeo asked for deployment timing, open blockers, and owners.",
          createdDateTime: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          teamName: "Hoplite Consulting",
          channelName: "Valeo Status",
          from: "michael@hopliteconsulting.com",
          webUrl: "https://teams.example/valeo"
        });
        fallbackMatches.push({
          id: "teams-thread-valeo",
          label: "Hoplite <> Valeo Status Update",
          why: "matched workspace name",
          teamName: "Hoplite Consulting",
          channelName: "Valeo Status",
          webUrl: "https://teams.example/valeo-thread"
        });
      }
      if (query.includes("ksm")) {
        messages.push({
          id: "teams-msg-ksm-1",
          subject: "KSM planning review",
          bodyPreview: "KSM needs a planning review before Friday and asked for timeline risks.",
          summary: "KSM needs a planning review before Friday and asked for timeline risks.",
          createdDateTime: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
          teamName: "Hoplite Consulting",
          channelName: "KSM Review",
          from: "teddy@hopliteconsulting.com",
          webUrl: "https://teams.example/ksm"
        });
      }
      return {
        messages,
        fallbackMatches,
        coverage,
        limitations: messages.length === 0 ? ["getAllMessages unsupported in delegated context; used chat fallback"] : []
      };
    }
  };
}

function createBenchEntityGraph(): EntityGraphLike {
  return {
    aliasesFor(name: string) {
      const lower = name.toLowerCase();
      if (lower === "valeo") return ["valeo", "valeo status", "client valeo"];
      if (lower === "ksm") return ["ksm", "sync - ksm <> hoplite"];
      return [];
    },
    lookup(name: string) {
      const lower = name.toLowerCase();
      if (lower.includes("valeo")) {
        return {
          query: name,
          entities: [
            {
              entityId: 1,
              name: "Valeo",
              entityType: "client",
              confidence: 0.92,
              mentions: [
                {
                  artifactId: "email-valeo-1",
                  domain: "outlook",
                  summary: "Valeo requested a status update and next steps.",
                  timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
                }
              ]
            }
          ]
        };
      }
      if (lower.includes("ksm")) {
        return {
          query: name,
          entities: [
            {
              entityId: 2,
              name: "KSM",
              entityType: "project",
              confidence: 0.88,
              mentions: [
                {
                  artifactId: "teams-msg-ksm-1",
                  domain: "teams",
                  summary: "KSM planning review requested before Friday.",
                  timestamp: new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString()
                }
              ]
            }
          ]
        };
      }
      return { query: name, entities: [] };
    }
  };
}

async function main() {
  const memory = new StructuredTurnMemory();
  memory.addTurn({ role: "user", text: "Valeo requested a status update and next steps by end of day", source: "fixture" });
  memory.addTurn({ role: "assistant", text: "Summarized Valeo blockers and KSM planning risks", source: "fixture" });
  memory.addTurn({ role: "user", text: "KSM asked for a planning review before Friday", source: "fixture" });
  memory.addTurn({ role: "user", text: "I work for Hoplite Consulting and need to coordinate client followups", source: "fixture" });

  const narrative = new NarrativeMemory("./data/retrieval-bench-fixture.jsonl");
  narrative.entries = [
    {
      timestamp: new Date().toISOString(),
      day: new Date().toISOString().slice(0, 10),
      kind: "summary",
      text: "Valeo and KSM are the active client contexts this week; Valeo needs a response and KSM needs planning review.",
      metadata: { source: "fixture" }
    },
    {
      timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      day: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      kind: "summary",
      text: "Teams review highlighted the Hoplite <> Valeo status thread and KSM review planning.",
      metadata: { source: "fixture" }
    }
  ];
  narrative.loaded = true;

  const cache = new InMemoryTranslationCache();
  cache.set(
    buildTranslationCacheKey({
      input: "search my email for invoices again",
      provider: "ollama",
      model: "llama3.1",
      composerConfig: {}
    }),
    {
      requestId: "cache-invoices-1",
      status: "ok",
      message: "Found cached invoices",
      finalText: "Found cached invoices from Microsoft",
      artifacts: {},
      memoryRefs: [],
      trace: {
        traceId: "trace-cache-1",
        requestId: "cache-invoices-1",
        provider: "ollama",
        model: "llama3.1",
        translationSource: "cache",
        schemaVersion: "1.0.0",
        agent: "ms.outlook",
        cacheHit: true,
        stageTimingsMs: {},
        validationErrors: [],
        executionError: null,
        timestamp: new Date().toISOString()
      }
    }
  );

  const engine = new RetrievalEngine({
    memory,
    cache,
    getCacheKey: (input) =>
      buildTranslationCacheKey({
        input,
        provider: "ollama",
        model: "llama3.1",
        composerConfig: {}
      }),
    sessionRefs: createBenchSessionRefs(),
    narrativeMemory: narrative as unknown as NarrativeMemoryLike,
    teamsIndex: createBenchTeamsIndex(),
    entityGraph: createBenchEntityGraph(),
    retrievalConfig: { maxItems: 8, tokenBudget: 1200 }
  });

  const bench = new RetrievalBench(engine, benchmarkCases);
  const results = await bench.run();
  const summary = results.map(({ id, result, checks, passed }) => ({
    id,
    passed,
    checks,
    intent: result.plan.intent,
    sources: result.plan.sources,
    entities: result.plan.entities,
    top: result.selectedEvidence[0]
      ? {
          id: result.selectedEvidence[0].id,
          source: result.selectedEvidence[0].sourceType,
          title: result.selectedEvidence[0].title ?? result.selectedEvidence[0].snippet.slice(0, 80),
          score: result.selectedEvidence[0].score ?? null
        }
      : null
  }));

  const aggregate = {
    total: results.length,
    passed: results.filter((item) => item.passed).length,
    failed: results.filter((item) => !item.passed).length
  };

  console.log(JSON.stringify({ aggregate, cases: summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
