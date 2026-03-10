// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";

import { composeResponse } from "../src/core/responseComposer.js";

test("response composer returns final text and suggestions", async () => {
  const out = await composeResponse({
    input: "search my email for invoices",
    actionEnvelope: {
      agent: "ms.outlook",
      action: "search_email"
    },
    executionResult: {
      status: "ok",
      message: "Found 3 email(s).",
      artifacts: {}
    },
    memoryRefs: [1, 2]
  });

  assert.match(out.finalText, /reviewed your email search/i);
  assert.equal(Array.isArray(out.suggestedActions), true);
  assert.equal(out.suggestedActions.length >= 1, true);
  assert.match(out.suggestedActions[0].rationale, /messages/i);
});

test("response composer chat mode returns direct conversational text", async () => {
  const out = await composeResponse({
    input: "hello",
    actionEnvelope: null,
    executionResult: { status: "ok", message: "" },
    memoryRefs: []
  });
  assert.equal(out.conversationMode, "chat");
  assert.doesNotMatch(out.finalText, /why this matters/i);
});

test("response composer chat mode uses freeform model output when available", async () => {
  const out = await composeResponse({
    input: "hello",
    actionEnvelope: null,
    executionResult: { status: "ok", message: "" },
    modelGateway: {
      getActiveProvider() {
        return "ollama";
      },
      getActiveModel() {
        return "llama3.1";
      },
      async completeText() {
        return "Hello. I am micro-claw. I can help with email and calendar workflows.";
      }
    },
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
    executionResult: { status: "ok", message: "" },
    modelGateway: {
      getActiveProvider() {
        return "ollama";
      },
      getActiveModel() {
        return "llama3.1";
      },
      async completeText() {
        return '{"summary":"General conversation mode activated."}';
      }
    },
    memoryRefs: []
  });
  assert.equal(out.conversationMode, "chat");
  assert.match(out.finalText, /I’m micro-claw/i);
  assert.equal(out.composer.source, "template_chat_fallback");
});

test("response composer teams review returns useful zero-result guidance", async () => {
  const out = await composeResponse({
    input: "did i miss anything in teams today?",
    actionEnvelope: {
      agent: "ms.teams",
      action: "review_my_day"
    },
    executionResult: {
      status: "ok",
      message: "Reviewed 0 Teams message(s).",
      artifacts: {
        source: "me.chats.messages_fallback",
        total: 0,
        prioritized: []
      }
    },
    memoryRefs: []
  });

  assert.match(out.finalText, /didn’t find any recent messages|found no/i);
  assert.equal(out.composer.source, "template_teams");
  assert.equal(Array.isArray(out.suggestedActions), true);
  assert.equal(out.suggestedActions.length >= 1, true);
  assert.equal(Array.isArray(out.evidence), true);
  assert.equal(out.evidence.some((e) => e.type === "teams_coverage"), true);
});

test("response composer read email includes recommendation language", async () => {
  const out = await composeResponse({
    input: "should i respond?",
    actionEnvelope: {
      agent: "ms.outlook",
      action: "read_email"
    },
    executionResult: {
      status: "ok",
      message: "Read email",
      artifacts: {
        id: "msg-1",
        subject: "Please review this today",
        from: "alex@example.com",
        receivedDateTime: "2026-03-05T10:00:00Z",
        bodyPreview: "Can you review this and reply with next steps?"
      }
    },
    memoryRefs: []
  });
  assert.match(out.finalText, /Recommendation:/);
  assert.match(out.finalText, /likely worth a response/i);
});

test("response composer read teams message includes recommendation language", async () => {
  const out = await composeResponse({
    input: "is that important?",
    actionEnvelope: {
      agent: "ms.teams",
      action: "read_message"
    },
    executionResult: {
      status: "ok",
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
    },
    memoryRefs: []
  });
  assert.match(out.finalText, /Recommendation:/);
  assert.match(out.finalText, /likely worth a response/i);
});

test("response composer teams search no-hit gives refinement guidance", async () => {
  const out = await composeResponse({
    input: "search teams for valeo",
    actionEnvelope: {
      agent: "ms.teams",
      action: "search_messages"
    },
    executionResult: {
      status: "ok",
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
    },
    memoryRefs: []
  });

  assert.match(out.finalText, /window=all|team\/channel name|narrow time window/i);
});

test("response composer teams search no-hit with window=all avoids broader-window suggestion", async () => {
  const out = await composeResponse({
    input: "search teams for valeo",
    actionEnvelope: {
      agent: "ms.teams",
      action: "search_messages"
    },
    executionResult: {
      status: "ok",
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
    },
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
    actionEnvelope: {
      agent: "ms.teams",
      action: "search_messages"
    },
    executionResult: {
      status: "ok",
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
    },
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
    actionEnvelope: {
      agent: "ms.teams",
      action: "search_messages"
    },
    executionResult: {
      status: "ok",
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
    },
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
    actionEnvelope: {
      agent: "ms.teams",
      action: "search_messages"
    },
    executionResult: {
      status: "ok",
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
    },
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
    actionEnvelope: {
      agent: "ms.teams",
      action: "search_messages"
    },
    executionResult: {
      status: "ok",
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
    },
    memoryRefs: []
  });

  assert.match(out.finalText, /relaxing scope|scope applied/i);
  const ids = out.suggestedActions.map((s) => s.id);
  assert.equal(ids.includes("teams-s9"), true);
  assert.equal(ids.includes("teams-s7"), false);
});
