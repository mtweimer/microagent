import test from "node:test";
import assert from "node:assert/strict";

import { resolveFollowupInput } from "../src/core/followupResolver.js";
import { makeSessionRefs } from "./helpers.js";

test("followup resolver maps email summary prompts to read_email", () => {
  const refs = makeSessionRefs();
  refs.outlook.lastEmailId = "msg-42";
  const out = resolveFollowupInput("what did they want?", refs);
  assert.ok(out);
  assert.equal(out.envelope.agent, "ms.outlook");
  assert.equal(out.envelope.action, "read_email");
  assert.equal(out.envelope.params.id, "msg-42");
});

test("followup resolver maps 'is that important' to read_email", () => {
  const refs = makeSessionRefs();
  refs.outlook.lastEmailId = "msg-99";
  const out = resolveFollowupInput("is that important?", refs);
  assert.ok(out);
  assert.equal(out.envelope.agent, "ms.outlook");
  assert.equal(out.envelope.action, "read_email");
  assert.equal(out.envelope.params.id, "msg-99");
});

test("followup resolver returns null without matching refs", () => {
  const out = resolveFollowupInput("what did they want?", makeSessionRefs());
  assert.equal(out, null);
});

test("followup resolver maps review-driven importance question to latest review email", () => {
  const refs = makeSessionRefs();
  refs.review.lastItems = [
    {
      id: "r1",
      title: "Review email",
      sourceDomain: "outlook",
      sourceArtifactId: "msg-review-1",
      triageClass: "needs_response",
      priority: "medium",
      rationale: "Needs response",
      evidence: []
    }
  ];
  const out = resolveFollowupInput("is that important?", refs);
  assert.ok(out);
  assert.equal(out.envelope.agent, "ms.outlook");
  assert.equal(out.envelope.action, "read_email");
  assert.equal(out.envelope.params.id, "msg-review-1");
});

test("followup resolver maps review-driven thread question to latest review teams item", () => {
  const refs = makeSessionRefs();
  refs.review.lastItems = [
    {
      id: "r2",
      title: "Review teams item",
      sourceDomain: "teams",
      sourceArtifactId: "teams-msg-1",
      triageClass: "important_fyi",
      priority: "low",
      rationale: "Thread context",
      evidence: []
    }
  ];
  const out = resolveFollowupInput("what thread was that from?", refs);
  assert.ok(out);
  assert.equal(out.envelope.agent, "ms.teams");
  assert.equal(out.envelope.action, "read_message");
  assert.equal(out.envelope.params.id, "teams-msg-1");
});
