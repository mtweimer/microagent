import test from "node:test";
import assert from "node:assert/strict";

import { composeResponse } from "../src/core/responseComposer.js";
import { makeEnvelope, makeExecutionResult, makeModelGateway } from "./helpers.js";

test("response composer returns final text and suggestions", async () => {
  const out = await composeResponse({
    input: "search my email for invoices",
    actionEnvelope: makeEnvelope({ agent: "ms.outlook", action: "search_email" }),
    executionResult: makeExecutionResult({ message: "Found 3 email(s).", artifacts: {} }),
    capabilityPack: { supportedDomains: [], supportedActions: {}, unsupportedKeywords: [], policy: "" },
    modelGateway: null,
    memoryRefs: [1, 2]
  });

  assert.match(out.finalText, /reviewed your email search/i);
  assert.equal(Array.isArray(out.suggestedActions), true);
  assert.equal(out.suggestedActions.length >= 1, true);
  assert.match(out.suggestedActions[0]?.rationale ?? "", /messages/i);
});

test("response composer chat mode returns direct conversational text", async () => {
  const out = await composeResponse({
    input: "hello",
    actionEnvelope: null,
    executionResult: makeExecutionResult({ message: "" }),
    capabilityPack: { supportedDomains: [], supportedActions: {}, unsupportedKeywords: [], policy: "" },
    modelGateway: null,
    memoryRefs: []
  });
  assert.equal(out.conversationMode, "chat");
  assert.doesNotMatch(out.finalText, /why this matters/i);
});

test("response composer chat mode uses freeform model output when available", async () => {
  const out = await composeResponse({
    input: "hello",
    actionEnvelope: null,
    executionResult: makeExecutionResult({ message: "" }),
    capabilityPack: { supportedDomains: [], supportedActions: {}, unsupportedKeywords: [], policy: "" },
    modelGateway: makeModelGateway({
      getActiveProvider() {
        return "ollama";
      },
      getActiveModel() {
        return "llama3.1";
      },
      async completeText() {
        return "Hello. I am micro-claw. I can help with email and calendar workflows.";
      }
    }),
    memoryRefs: []
  });
  assert.equal(out.conversationMode, "chat");
  assert.match(out.finalText, /I can help with email and calendar workflows/i);
  assert.equal(out.composer.source, "llm_chat");
});

test("response composer chat mode rejects schema-like outputs and falls back", async () => {
  const out = await composeResponse({
    input: "hello",
    actionEnvelope: null,
    executionResult: makeExecutionResult({ message: "" }),
    capabilityPack: { supportedDomains: [], supportedActions: {}, unsupportedKeywords: [], policy: "" },
    modelGateway: makeModelGateway({
      getActiveProvider() {
        return "ollama";
      },
      getActiveModel() {
        return "llama3.1";
      },
      async completeText() {
        return '{"summary":"General conversation mode activated."}';
      }
    }),
    memoryRefs: []
  });
  assert.equal(out.conversationMode, "chat");
  assert.match(out.finalText, /I’m micro-claw/i);
  assert.equal(out.composer.source, "template_chat_fallback");
});

test("response composer teams review returns useful zero-result guidance", async () => {
  const out = await composeResponse({
    input: "did i miss anything in teams today?",
    actionEnvelope: makeEnvelope({ agent: "ms.teams", action: "review_my_day" }),
    executionResult: makeExecutionResult({
      message: "Reviewed 0 Teams message(s).",
      artifacts: {
        source: "me.chats.messages_fallback",
        total: 0,
        prioritized: []
      }
    }),
    capabilityPack: { supportedDomains: [], supportedActions: {}, unsupportedKeywords: [], policy: "" },
    modelGateway: null,
    memoryRefs: []
  });

  assert.match(out.finalText, /didn’t find any recent messages|found no/i);
  assert.equal(out.composer.source, "template_teams");
  assert.equal(Array.isArray(out.suggestedActions), true);
  assert.equal(out.suggestedActions.length >= 1, true);
  assert.equal(Array.isArray(out.evidence), true);
  assert.equal(out.evidence.some((e) => e.type === "teams_coverage"), true);
});

test("response composer teams review uses retrieval context when live scan is empty", async () => {
  const out = await composeResponse({
    input: "did i miss anything in teams today?",
    actionEnvelope: makeEnvelope({ agent: "ms.teams", action: "review_my_day" }),
    executionResult: makeExecutionResult({
      message: "Reviewed 0 Teams message(s).",
      artifacts: {
        source: "me.chats.messages_fallback",
        total: 0,
        prioritized: [],
        coverage: {
          chatsScanned: 12,
          chatMessagesScanned: 0,
          channelsScanned: 20,
          channelMessagesScanned: 73
        },
        limitations: []
      }
    }),
    capabilityPack: { supportedDomains: [], supportedActions: {}, unsupportedKeywords: [], policy: "" },
    modelGateway: null,
    memoryRefs: [],
    retrieval: {
      plan: {
        intent: "timeline",
        query: "did i miss anything in teams today?",
        entities: ["Valeo"],
        sources: ["teams-index", "narrative-memory"],
        traversalMode: "none",
        maxItems: 6,
        maxDepth: 1,
        tokenBudget: 800
      },
      selectedEvidence: [],
      overflowEvidence: [],
      packs: {
        answerPack: [
          {
            id: "teams-1",
            source: "teams-index",
            sourceType: "teams-index",
            title: "Valeo blockers",
            snippet: "Valeo asked for blockers and next steps."
          }
        ],
        reasoningPack: [],
        followupPack: []
      },
      trace: {
        gatherers: ["teams-index"],
        latencyMsByGatherer: {},
        countsBySource: { "teams-index": 1 },
        selectedIds: ["teams-1"],
        overflowIds: [],
        selectionReasonById: { "teams-1": "selected:within_budget" },
        tokenContributionBySource: { "teams-index": 20 },
        scoreBreakdownById: {}
      }
    }
  });

  assert.match(out.finalText, /strongest related context i found/i);
  assert.match(out.finalText, /Valeo blockers/i);
});

test("response composer read email includes recommendation language", async () => {
  const out = await composeResponse({
    input: "should i respond?",
    actionEnvelope: makeEnvelope({ agent: "ms.outlook", action: "read_email" }),
    executionResult: makeExecutionResult({
      message: "Read email",
      artifacts: {
        id: "msg-1",
        subject: "Please review this today",
        from: "alex@example.com",
        receivedDateTime: "2026-03-05T10:00:00Z",
        bodyPreview: "Can you review this and reply with next steps?"
      }
    }),
    capabilityPack: { supportedDomains: [], supportedActions: {}, unsupportedKeywords: [], policy: "" },
    modelGateway: null,
    memoryRefs: []
  });
  assert.match(out.finalText, /Recommendation:/);
  assert.match(out.finalText, /likely worth a response/i);
});

test("response composer read teams message includes recommendation language", async () => {
  const out = await composeResponse({
    input: "is that important?",
    actionEnvelope: makeEnvelope({ agent: "ms.teams", action: "read_message" }),
    executionResult: makeExecutionResult({
      message: "Read Teams message.",
      artifacts: {
        id: "t-1",
        sourceType: "channel",
        from: "Matthew",
        createdDateTime: "2026-03-05T10:00:00Z",
        teamName: "Valeo",
        channelName: "General",
        bodyPreview: "Please review the latest Valeo update and respond with blockers."
      }
    }),
    capabilityPack: { supportedDomains: [], supportedActions: {}, unsupportedKeywords: [], policy: "" },
    modelGateway: null,
    memoryRefs: []
  });
  assert.match(out.finalText, /Recommendation:/);
  assert.match(out.finalText, /likely worth a response/i);
});

test("response composer chat mode can answer retrieval-backed followups deterministically", async () => {
  const out = await composeResponse({
    input: "what did Valeo want?",
    actionEnvelope: null,
    executionResult: makeExecutionResult({ message: "" }),
    capabilityPack: { supportedDomains: [], supportedActions: {}, unsupportedKeywords: [], policy: "" },
    modelGateway: null,
    memoryRefs: [],
    retrieval: {
      plan: {
        intent: "exact",
        query: "what did Valeo want?",
        entities: ["Valeo"],
        sources: ["structured-memory", "entity-graph"],
        traversalMode: "none",
        maxItems: 6,
        maxDepth: 1,
        tokenBudget: 800
      },
      selectedEvidence: [],
      overflowEvidence: [],
      packs: {
        answerPack: [
          {
            id: "entity-1",
            source: "entity-graph",
            sourceType: "entity-graph",
            title: "Valeo request",
            snippet: "Valeo asked for a status update and next steps by end of day."
          }
        ],
        reasoningPack: [],
        followupPack: []
      },
      trace: {
        gatherers: ["entity-graph"],
        latencyMsByGatherer: {},
        countsBySource: { "entity-graph": 1 },
        selectedIds: ["entity-1"],
        overflowIds: [],
        selectionReasonById: { "entity-1": "selected:within_budget" },
        tokenContributionBySource: { "entity-graph": 20 },
        scoreBreakdownById: {}
      }
    }
  });

  assert.match(out.finalText, /strongest evidence suggests/i);
  assert.match(out.finalText, /status update and next steps/i);
});

test("response composer teams search no-hit gives refinement guidance", async () => {
  const out = await composeResponse({
    input: "search teams for valeo",
    actionEnvelope: makeEnvelope({ agent: "ms.teams", action: "search_messages" }),
    executionResult: makeExecutionResult({
      message: "Found 0 Teams message(s) matching 'valeo'.",
      artifacts: {
        query: "valeo",
        searchMode: "multi_surface",
        searchableMatches: 0,
        params: { window: "today", surface: "both", depth: "balanced" },
        total: 0,
        hits: [],
        coverage: {
          chatsScanned: 10,
          chatMessagesScanned: 0,
          channelsScanned: 8,
          channelMessagesScanned: 120
        },
        limitations: []
      }
    }),
    capabilityPack: { supportedDomains: [], supportedActions: {}, unsupportedKeywords: [], policy: "" },
    modelGateway: null,
    memoryRefs: []
  });

  assert.match(out.finalText, /window=all|team\/channel name|narrow time window/i);
});

test("response composer teams search no-hit with window=all avoids broader-window suggestion", async () => {
  const out = await composeResponse({
    input: "search teams for valeo",
    actionEnvelope: makeEnvelope({ agent: "ms.teams", action: "search_messages" }),
    executionResult: makeExecutionResult({
      message: "Found 0 Teams message(s) matching 'valeo'.",
      artifacts: {
        query: "valeo",
        searchableMatches: 0,
        params: { window: "all", surface: "both", depth: "balanced", top: 30 },
        total: 0,
        hits: [],
        coverage: {
          chatsScanned: 13,
          chatMessagesScanned: 0,
          channelsScanned: 9,
          channelMessagesScanned: 30
        },
        limitations: []
      }
    }),
    capabilityPack: { supportedDomains: [], supportedActions: {}, unsupportedKeywords: [], policy: "" },
    modelGateway: null,
    memoryRefs: []
  });

  assert.doesNotMatch(out.finalText, /broadening to `window=all`/i);
  assert.match(out.finalText, /increasing `top` and `depth=deep`|team\/channel name/i);
  const ids = out.suggestedActions.map((s) => s.id);
  assert.equal(ids.includes("teams-s5"), false);
  assert.equal(ids.includes("teams-s6") || ids.includes("teams-s7"), true);
});

test("response composer teams search no-hit includes workspace fallback hints", async () => {
  const out = await composeResponse({
    input: "search teams for valeo",
    actionEnvelope: makeEnvelope({ agent: "ms.teams", action: "search_messages" }),
    executionResult: makeExecutionResult({
      message: "Found 0 Teams message(s) matching 'valeo'.",
      artifacts: {
        query: "valeo",
        searchableMatches: 0,
        fallbackMatches: [{ type: "team", id: "t1", label: "Valeo Penetration Test", score: 12 }],
        params: { window: "all", surface: "both", depth: "balanced", top: 30 },
        total: 0,
        hits: [],
        coverage: {
          chatsScanned: 13,
          chatMessagesScanned: 0,
          channelsScanned: 9,
          channelMessagesScanned: 30
        },
        limitations: []
      }
    }),
    capabilityPack: { supportedDomains: [], supportedActions: {}, unsupportedKeywords: [], policy: "" },
    modelGateway: null,
    memoryRefs: []
  });

  assert.match(out.finalText, /matching workspace names/i);
  const ids = out.suggestedActions.map((s) => s.id);
  assert.equal(ids.includes("teams-s8"), true);
  assert.equal(out.evidence.some((e) => e.type === "teams_workspace_match"), true);
});

test("response composer teams search chat fallback makes teams-s8 chat-focused", async () => {
  const out = await composeResponse({
    input: "search teams for ksm",
    actionEnvelope: makeEnvelope({ agent: "ms.teams", action: "search_messages" }),
    executionResult: makeExecutionResult({
      message: "Found 0 Teams message(s) matching 'ksm'.",
      artifacts: {
        query: "ksm",
        searchableMatches: 0,
        fallbackMatches: [{ type: "chat", id: "c1", label: "Sync - KSM <> Hoplite", score: 9 }],
        params: { window: "all", surface: "both", depth: "deep", top: 100 },
        total: 0,
        hits: [],
        coverage: {
          chatsScanned: 25,
          chatMessagesScanned: 0,
          channelsScanned: 0,
          channelMessagesScanned: 0
        },
        limitations: []
      }
    }),
    capabilityPack: { supportedDomains: [], supportedActions: {}, unsupportedKeywords: [], policy: "" },
    modelGateway: null,
    memoryRefs: []
  });

  const s8 = out.suggestedActions.find((s) => s.id === "teams-s8");
  assert.ok(s8);
  assert.equal(s8.actionEnvelope.params.surface, "chats");
  assert.equal(s8.actionEnvelope.params.query, "ksm");
  assert.equal(s8.actionEnvelope.params.team, "Sync - KSM <> Hoplite");
});

test("response composer teams search max-scan no-hit avoids deep-scan suggestion", async () => {
  const out = await composeResponse({
    input: "search teams for valeo",
    actionEnvelope: makeEnvelope({ agent: "ms.teams", action: "search_messages" }),
    executionResult: makeExecutionResult({
      message: "Found 0 Teams message(s) matching 'valeo'.",
      artifacts: {
        query: "valeo",
        searchableMatches: 0,
        params: { window: "all", surface: "both", depth: "deep", top: 100 },
        total: 0,
        hits: [],
        coverage: {
          chatsScanned: 20,
          chatMessagesScanned: 0,
          channelsScanned: 20,
          channelMessagesScanned: 100
        },
        limitations: []
      }
    }),
    capabilityPack: { supportedDomains: [], supportedActions: {}, unsupportedKeywords: [], policy: "" },
    modelGateway: null,
    memoryRefs: []
  });

  assert.doesNotMatch(out.finalText, /increasing `top` and `depth=deep`/i);
  assert.match(out.finalText, /max scan settings|team\/channel-scoped/i);
  const ids = out.suggestedActions.map((s) => s.id);
  assert.equal(ids.includes("teams-s6"), false);
});

test("response composer teams search max-scan scoped no-hit suggests relaxing scope", async () => {
  const out = await composeResponse({
    input: "search teams for review team=hoplite channel=general",
    actionEnvelope: makeEnvelope({ agent: "ms.teams", action: "search_messages" }),
    executionResult: makeExecutionResult({
      message: "Found 0 Teams message(s) matching 'review'.",
      artifacts: {
        query: "review",
        searchableMatches: 0,
        params: { window: "all", surface: "channels", depth: "deep", top: 100, team: "hoplite", channel: "general" },
        total: 0,
        hits: [],
        coverage: {
          chatsScanned: 0,
          chatMessagesScanned: 0,
          channelsScanned: 0,
          channelMessagesScanned: 0
        },
        limitations: []
      }
    }),
    capabilityPack: { supportedDomains: [], supportedActions: {}, unsupportedKeywords: [], policy: "" },
    modelGateway: null,
    memoryRefs: []
  });

  assert.match(out.finalText, /relaxing scope|scope applied/i);
  const ids = out.suggestedActions.map((s) => s.id);
  assert.equal(ids.includes("teams-s9"), true);
  assert.equal(ids.includes("teams-s7"), false);
});
