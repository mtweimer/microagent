import test from "node:test";
import assert from "node:assert/strict";

import { normalizeTeamsParams } from "../src/agents/teams/actions/_teamsParams.js";

test("normalizeTeamsParams supports sender/time/importance filters", () => {
  const out = normalizeTeamsParams(
    {
      query: "hoplite",
      sender: "  workflows  ",
      since: "2026-03-01T00:00:00Z",
      until: "2026-03-05T00:00:00Z",
      importance: "HIGH",
      depth: "full"
    },
    { top: 30, window: "30d", surface: "both", depth: "balanced" }
  );

  assert.equal(out.query, "hoplite");
  assert.equal(out.sender, "workflows");
  assert.equal(out.since, "2026-03-01T00:00:00.000Z");
  assert.equal(out.until, "2026-03-05T00:00:00.000Z");
  assert.equal(out.importance, "high");
  assert.equal(out.depth, "full");
});

