import test from "node:test";
import assert from "node:assert/strict";

import { normalizeEnvelopeParams } from "../src/core/normalizeParams.js";

test("normalize calendar schedule_event attendees and when", () => {
  const out = normalizeEnvelopeParams({
    requestId: "r1",
    schemaVersion: "1.0.0",
    agent: "ms.calendar",
    action: "schedule_event",
    params: {
      summary: "Design Review",
      start: { dateTime: "2026-03-05T14:00:00" },
      attendees: [
        { email: "alex@example.com" },
        { emailAddress: { address: "alex@example.com" } },
        "not-an-email"
      ]
    }
  });

  assert.ok(out);
  assert.deepEqual(out.params, {
    title: "Design Review",
    when: "2026-03-05T14:00:00",
    attendees: ["alex@example.com"]
  });
});

test("normalize outlook send_email canonical params", () => {
  const out = normalizeEnvelopeParams({
    requestId: "r2",
    schemaVersion: "1.0.0",
    agent: "ms.outlook",
    action: "send_email",
    params: {
      recipients: [{ emailAddress: { address: "sam@example.com" } }],
      message: "hello"
    }
  });

  assert.ok(out);
  assert.deepEqual(out.params, {
    to: ["sam@example.com"],
    subject: "Drafted by dispatcher",
    body: "hello"
  });
});

test("normalize outlook read_email converts id latest alias to reference", () => {
  const out = normalizeEnvelopeParams({
    requestId: "r3",
    schemaVersion: "1.0.0",
    agent: "ms.outlook",
    action: "read_email",
    params: {
      id: "latest"
    }
  });

  assert.ok(out);
  assert.deepEqual(out.params, {
    reference: "latest"
  });
});

test("normalize teams params accepts extended windows and defaults", () => {
  const out = normalizeEnvelopeParams({
    requestId: "r4",
    schemaVersion: "1.0.0",
    agent: "ms.teams",
    action: "search_messages",
    params: {
      query: "valeo",
      window: "all",
      surface: "channels",
      depth: "balanced",
      top: 120
    }
  });

  assert.ok(out);
  assert.deepEqual(out.params, {
    query: "valeo",
    window: "all",
    surface: "channels",
    depth: "balanced",
    top: 100
  });
});
