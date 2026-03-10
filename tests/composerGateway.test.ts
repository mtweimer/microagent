import test from "node:test";
import assert from "node:assert/strict";

import { composeWithFallback } from "../src/core/composerGateway.js";
import { makeModelGateway } from "./helpers.js";

test("composer gateway retries fallback on low confidence", async () => {
  const calls: Array<string | undefined> = [];
  const modelGateway = makeModelGateway({
    async completeJson(_messages: unknown, options: { model?: string } = {}) {
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
  });

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
