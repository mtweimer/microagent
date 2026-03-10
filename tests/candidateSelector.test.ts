import test from "node:test";
import assert from "node:assert/strict";

import { selectDomainCandidates } from "../src/core/candidateSelector.js";

test("candidate selector picks outlook for inbox/email query", () => {
  const out = selectDomainCandidates("search my inbox for client invoices");
  assert.equal(out.primary, "outlook");
  assert.equal(out.candidates.length >= 1, true);
});

test("candidate selector marks ambiguous close matches", () => {
  const out = selectDomainCandidates("check chat and email updates");
  assert.equal(out.candidates.length >= 2, true);
  assert.equal(typeof out.ambiguous, "boolean");
});
