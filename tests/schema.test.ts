// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";

import { validateActionEnvelope } from "../src/core/schema.js";

test("strict validation fails unknown action", () => {
  const result = validateActionEnvelope({
    requestId: "r1",
    agent: "ms.calendar",
    action: "unknown_action",
    params: {},
    schemaVersion: "1.0.0"
  });

  assert.equal(result.ok, false);
  assert.match(result.errors[0], /Unknown action/);
});

test("strict validation fails schema version mismatch", () => {
  const result = validateActionEnvelope({
    requestId: "r2",
    agent: "ms.calendar",
    action: "find_events",
    params: { timeRange: "today" },
    schemaVersion: "0.0.1"
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("Schema version mismatch")));
});
