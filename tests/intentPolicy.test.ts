// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";

import { classifyIntent } from "../src/core/intentPolicy.js";

test("intent policy marks imperative request as action", () => {
  const out = classifyIntent("schedule a project sync tomorrow at 3pm", "calendar");
  assert.equal(out.type, "action");
});

test("intent policy marks declarative past-tense statement as memory statement", () => {
  const out = classifyIntent("Kevin sent email to Satya about new AI models.", "outlook");
  assert.equal(out.type, "memory_statement");
});

test("intent policy clarifies when no domain", () => {
  const out = classifyIntent("set something up later", null);
  assert.equal(out.type, "clarify");
});

test("intent policy treats review/examine verbs as actions", () => {
  const out = classifyIntent("examine my inbox today and suggest next actions", "outlook");
  assert.equal(out.type, "action");
});

test("intent policy treats fetch/retrieve verbs as actions", () => {
  const out = classifyIntent("fetch my latest email", "outlook");
  assert.equal(out.type, "action");
});
