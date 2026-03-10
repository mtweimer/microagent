import test from "node:test";
import assert from "node:assert/strict";

import { rankTeamsMessagesByQuery } from "../src/agents/teams/actions/_teamsRanking.js";

function msg({ id, from, bodyPreview, createdDateTime }) {
  return {
    id,
    from,
    bodyPreview,
    createdDateTime,
    importance: "normal",
    teamName: "Hoplite - Marketing",
    channelName: "General",
    chatTopic: "",
    mentions: [],
    attachmentNames: []
  };
}

test("teams ranking config can aggressively down-rank automation senders", () => {
  const now = new Date().toISOString();
  const rows = [
    msg({
      id: "a1",
      from: "Workflows",
      bodyPreview: "hoplite status update",
      createdDateTime: now
    }),
    msg({
      id: "h1",
      from: "Matthew Guzek",
      bodyPreview: "hoplite status update",
      createdDateTime: now
    })
  ];

  const neutral = rankTeamsMessagesByQuery(rows, "hoplite", {
    limit: 2,
    options: { automationPenalty: "neutral" }
  });
  const aggressive = rankTeamsMessagesByQuery(rows, "hoplite", {
    limit: 2,
    options: { automationPenalty: "aggressive" }
  });

  assert.equal(neutral.length, 2);
  assert.equal(aggressive.length, 2);
  assert.equal(aggressive[0].from, "Matthew Guzek");
});

