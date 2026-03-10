import test from "node:test";
import assert from "node:assert/strict";

import { rankTeamsMessagesByQuery } from "../src/agents/teams/actions/_teamsRanking.js";

interface RankingInputMessage {
  id: string;
  from: string;
  bodyPreview: string;
  createdDateTime: string;
}

function msg({ id, from, bodyPreview, createdDateTime }: RankingInputMessage) {
  return {
    id,
    sourceType: "channel" as const,
    sourcePath: "/teams/t1/channels/c1/messages",
    from,
    createdDateTime,
    importance: "normal",
    webUrl: null,
    subject: null,
    summary: null,
    bodyPreview,
    mentions: [],
    attachmentNames: [],
    chatId: null,
    chatTopic: "",
    teamId: "t1",
    teamName: "Hoplite - Marketing",
    channelId: "c1",
    channelName: "General"
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
  assert.equal(aggressive[0]?.from, "Matthew Guzek");
});
