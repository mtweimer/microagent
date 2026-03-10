// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";

import { deriveRetrievalPlan } from "../src/core/retrievalPlan.js";

test("deriveRetrievalPlan builds outlook retrieval plan", () => {
  const plan = deriveRetrievalPlan({
    input: "fetch my latest 2 emails",
    routeDecision: { mode: "retrieval" },
    envelope: {
      agent: "ms.outlook",
      action: "search_email",
      params: { query: "latest emails" }
    },
    executionResult: { artifacts: { searchMode: "top_n_recent" } }
  });
  assert.equal(plan.domain, "outlook");
  assert.equal(plan.queryMode, "top_n_recent");
  assert.equal(plan.limit, 2);
});

test("deriveRetrievalPlan builds teams retrieval constraints", () => {
  const plan = deriveRetrievalPlan({
    input: "search teams for valeo",
    routeDecision: { mode: "retrieval" },
    envelope: {
      agent: "ms.teams",
      action: "search_messages",
      params: { query: "valeo", window: "30d", surface: "both", depth: "balanced", top: 25 }
    },
    executionResult: { artifacts: {} }
  });
  assert.equal(plan.domain, "teams");
  assert.equal(plan.queryMode, "multi_surface_filter");
  assert.equal(plan.constraints.window, "30d");
});
