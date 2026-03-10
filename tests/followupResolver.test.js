import test from "node:test";
import assert from "node:assert/strict";

import { resolveFollowupInput } from "../src/core/followupResolver.js";

test("followup resolver maps email summary prompts to read_email", () => {
  const out = resolveFollowupInput("what did they want?", {
    outlook: { lastEmailId: "msg-42" }
  });
  assert.equal(out.envelope.agent, "ms.outlook");
  assert.equal(out.envelope.action, "read_email");
  assert.equal(out.envelope.params.id, "msg-42");
});

test("followup resolver maps 'is that important' to read_email", () => {
  const out = resolveFollowupInput("is that important?", {
    outlook: { lastEmailId: "msg-99" }
  });
  assert.equal(out.envelope.agent, "ms.outlook");
  assert.equal(out.envelope.action, "read_email");
  assert.equal(out.envelope.params.id, "msg-99");
});

test("followup resolver returns null without matching refs", () => {
  const out = resolveFollowupInput("what did they want?", {
    outlook: { lastEmailId: null }
  });
  assert.equal(out, null);
});

test("followup resolver maps review-driven importance question to latest review email", () => {
  const out = resolveFollowupInput("is that important?", {
    review: {
      lastItems: [
        {
          sourceDomain: "outlook",
          sourceArtifactId: "msg-review-1"
        }
      ]
    }
  });
  assert.equal(out.envelope.agent, "ms.outlook");
  assert.equal(out.envelope.action, "read_email");
  assert.equal(out.envelope.params.id, "msg-review-1");
});

test("followup resolver maps review-driven thread question to latest review teams item", () => {
  const out = resolveFollowupInput("what thread was that from?", {
    review: {
      lastItems: [
        {
          sourceDomain: "teams",
          sourceArtifactId: "teams-msg-1"
        }
      ]
    }
  });
  assert.equal(out.envelope.agent, "ms.teams");
  assert.equal(out.envelope.action, "read_message");
  assert.equal(out.envelope.params.id, "teams-msg-1");
});
