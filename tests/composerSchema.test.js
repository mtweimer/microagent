import test from "node:test";
import assert from "node:assert/strict";

import { normalizeComposerOutput, validateComposerOutput } from "../src/core/composerSchema.js";

test("composer schema normalizes and validates output", () => {
  const normalized = normalizeComposerOutput({
    summary: "done",
    intent: "assist",
    reasoning: "because",
    evidence: [],
    suggestions: [],
    confidence: 0.8
  });
  const valid = validateComposerOutput(normalized);
  assert.equal(valid.ok, true);
});

