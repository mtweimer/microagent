// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";

import { composeWithFallback } from "../src/core/composerGateway.js";

test("composer gateway retries fallback on low confidence", async () => {
  const calls = [];
  const modelGateway = {
    async completeJson(_messages, options = {}) {
      calls.push(options.model);
      if (options.model === "primary") {
        return {
          summary: "ok",
          intent: "assist",
          reasoning: "test",
          evidence: [],
          suggestions: [],
          confidence: 0.2
        };
      }
      return {
        summary: "ok",
        intent: "assist",
        reasoning: "test",
        evidence: [],
        suggestions: [],
        confidence: 0.9
      };
    }
  };

  const out = await composeWithFallback({
    modelGateway,
    messages: [{ role: "user", content: "hello" }],
    primary: { provider: "ollama", model: "primary" },
    fallback: { provider: "ollama", model: "fallback" },
    minConfidence: 0.5
  });

  assert.equal(out.ok, true);
  assert.equal(out.used, "fallback");
  assert.deepEqual(calls, ["primary", "fallback"]);
});

