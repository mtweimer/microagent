import test from "node:test";
import assert from "node:assert/strict";

import { decideRoute } from "../src/core/routerDecision.js";

test("router marks weather request as unsupported", () => {
  const out = decideRoute({
    input: "what's the weather in Indianapolis right now",
    domain: null,
    selection: { ambiguous: false, candidates: [] },
    intent: { type: "clarify" }
  });
  assert.equal(out.mode, "unsupported");
  assert.match(out.unsupportedReason, /unsupported_capability/);
});

test("router marks fetch latest email as retrieval when domain is outlook", () => {
  const out = decideRoute({
    input: "fetch my latest email",
    domain: "outlook",
    selection: { ambiguous: false, candidates: [{ domain: "outlook", score: 2 }] },
    intent: { type: "action" }
  });
  assert.equal(out.mode, "retrieval");
});

