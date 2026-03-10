import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { TeamsIndex } from "../src/core/teamsIndex.js";
import { readMessageAction } from "../src/agents/teams/actions/readMessage.js";

const FILE = "/tmp/micro-claw-teams-read.test.sqlite";

test("teams read_message returns indexed message details", async () => {
  try {
    fs.unlinkSync(FILE);
  } catch {}
  const index = new TeamsIndex({ dbPath: FILE, retentionDays: 365 });
  index.initialize();
  index.upsertMessageStmt.run(
    "msg-1",
    "channel",
    "Matthew",
    "2026-03-05T10:00:00Z",
    "normal",
    "https://teams.example/msg-1",
    null,
    null,
    "Please review the latest Valeo changes.",
    null,
    null,
    "team-1",
    "Valeo Team",
    "channel-1",
    "General",
    "2026-03-05T10:00:00Z"
  );
  const out = await readMessageAction(
    { params: { id: "msg-1" } },
    { teamsIndex: index }
  );
  assert.equal(out.status, "ok");
  assert.equal(out.artifacts.id, "msg-1");
  assert.match(out.artifacts.bodyPreview, /Valeo/);
});
