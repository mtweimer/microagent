import test from "node:test";
import assert from "node:assert/strict";

import { runReviewOrchestrator } from "../src/core/reviewOrchestrator.js";
import type { RetrievalResult } from "../src/core/contracts.js";
import { makeDispatcherResponse } from "./helpers.js";

const baseOutput = makeDispatcherResponse({
  status: "ok",
  finalText: "Found follow-up item",
  artifacts: {
    action: {
      requestId: "r1",
      schemaVersion: "1.0.0",
      agent: "ms.outlook",
      action: "search_email",
      params: {}
    },
    result: {
      messages: [
        {
          id: "msg-1",
          subject: "Valeo follow-up",
          from: "owner@example.com",
          receivedDateTime: "2026-03-10T12:00:00Z"
        }
      ]
    }
  }
});

test("review orchestrator prefers retrieval-backed evidence when available", async () => {
  const dispatcher = {
    agents: [{ id: "ms.outlook" }],
    sessionRefs: {
      outlook: { lastEmailId: null, lastEmailIds: [] },
      calendar: { lastEventSubject: null, lastEventLink: null, lastTimeRange: null },
      teams: { lastThreadId: null, lastMessageIds: [], lastTeam: null, lastChannel: null },
      review: { lastTarget: null, lastItems: [] },
      entities: { lastNames: [] }
    },
    async route() {
      return baseOutput;
    },
    async buildRetrievalResult(): Promise<RetrievalResult> {
      return {
        plan: {
          intent: "contextual",
          query: "review followups",
          entities: ["Valeo"],
          sources: ["structured-memory"],
          traversalMode: "none",
          maxItems: 6,
          maxDepth: 1,
          tokenBudget: 1000
        },
        selectedEvidence: [
          {
            id: "retrieval-1",
            source: "structured-memory",
            sourceType: "structured-memory",
            title: "Valeo follow-up",
            snippet: "Customer asked for a reply"
          }
        ],
        overflowEvidence: [],
        packs: {
          answerPack: [],
          reasoningPack: [],
          followupPack: []
        },
        trace: {
          gatherers: ["structured-memory"],
          latencyMsByGatherer: {},
          countsBySource: { "structured-memory": 1 },
          selectedIds: ["retrieval-1"],
          overflowIds: [],
          tokenContributionBySource: { "structured-memory": 20 },
          scoreBreakdownById: {}
        }
      };
    }
  };

  const out = await runReviewOrchestrator({ target: "followups", dispatcher, entityGraph: null });
  assert.equal(out.evidence?.[0]?.id, "retrieval-1");
  assert.equal((out.artifacts.retrieval as { plan?: { query?: string } }).plan?.query, "review followups");
});
