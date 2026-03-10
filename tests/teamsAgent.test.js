import test from "node:test";
import assert from "node:assert/strict";

import { TeamsAgent } from "../src/agents/teams/index.js";

function isoHoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function isoTodayAt(hour, minute = 0) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0).toISOString();
}

test("teams search_messages finds matches across chats and channels", async () => {
  const agent = new TeamsAgent();
  const recentA = isoHoursAgo(2);
  const recentB = isoHoursAgo(1);
  const out = await agent.execute(
    {
      requestId: "t1",
      schemaVersion: "1.0.0",
      agent: "ms.teams",
      action: "search_messages",
      params: { query: "phoenix", top: 20, surface: "both", window: "7d", depth: "balanced" }
    },
    {
      graphClient: {
        async get(path) {
          if (path.startsWith("/me/chats/getAllMessages")) {
            throw new Error(
              "Graph GET /me/chats/getAllMessages failed: 412 {\"error\":{\"code\":\"PreconditionFailed\",\"message\":\"not supported in delegated context\"}}"
            );
          }
          if (path.startsWith("/me/chats?")) return { value: [{ id: "c1", topic: "Ops" }] };
          if (path.startsWith("/me/chats/c1/messages")) {
            return {
              value: [
                {
                  id: "chat-hit",
                  bodyPreview: "Status update from thread",
                  summary: "Phoenix milestone status",
                  createdDateTime: recentA
                }
              ]
            };
          }
          if (path.startsWith("/me/joinedTeams")) return { value: [{ id: "t1", displayName: "Delivery" }] };
          if (path.startsWith("/teams/t1/channels?")) return { value: [{ id: "ch1", displayName: "General" }] };
          if (path.startsWith("/teams/t1/channels/ch1/messages")) {
            return {
              value: [
                {
                  id: "chan-hit",
                  body: { content: "<p>Status update</p>" },
                  channelIdentity: { teamId: "t1", channelId: "ch1" },
                  mentions: [{ mentionText: "Phoenix" }],
                  attachments: [{ name: "phoenix-plan.docx" }],
                  createdDateTime: recentB
                }
              ]
            };
          }
          return { value: [] };
        }
      }
    }
  );
  assert.equal(out.status, "ok");
  assert.equal(out.artifacts.hits.length, 2);
  assert.equal(out.artifacts.hits[0].score > 0, true);
  assert.equal(Array.isArray(out.artifacts.hits[0].searchableFieldsMatched), true);
  assert.equal(out.artifacts.coverage.chatsScanned >= 1, true);
  assert.equal(out.artifacts.coverage.channelsScanned >= 1, true);
});

test("teams review_my_day prioritizes urgent content with rationale", async () => {
  const agent = new TeamsAgent();
  const recent = isoTodayAt(15, 0);
  const older = isoTodayAt(10, 30);
  const out = await agent.execute(
    {
      requestId: "t2",
      schemaVersion: "1.0.0",
      agent: "ms.teams",
      action: "review_my_day",
      params: { top: 10, surface: "chats", window: "today", depth: "balanced" }
    },
    {
      graphClient: {
        async get(path) {
          if (path.startsWith("/me/chats/getAllMessages")) {
            return {
              value: [
                {
                  id: "a",
                  bodyPreview: "please review this when you can",
                  createdDateTime: older
                },
                {
                  id: "b",
                  bodyPreview: "urgent: need response asap",
                  createdDateTime: recent,
                  importance: "high"
                }
              ]
            };
          }
          return { value: [] };
        }
      }
    }
  );
  assert.equal(out.status, "ok");
  assert.equal(out.artifacts.prioritized[0].id, "b");
  assert.match(out.artifacts.prioritized[0].why, /urgent|importance/i);
});

test("teams search_mentions returns mention-like messages", async () => {
  const agent = new TeamsAgent();
  const recent = isoTodayAt(14, 0);
  const older = isoTodayAt(11, 0);
  const out = await agent.execute(
    {
      requestId: "t3",
      schemaVersion: "1.0.0",
      agent: "ms.teams",
      action: "search_mentions",
      params: { top: 10, surface: "chats", window: "today", depth: "balanced" }
    },
    {
      graphClient: {
        async get(path) {
          if (path.startsWith("/me/chats/getAllMessages")) {
            return {
              value: [
                { id: "m1", bodyPreview: "@michael please review", createdDateTime: recent },
                { id: "m2", bodyPreview: "status update", createdDateTime: older }
              ]
            };
          }
          return { value: [] };
        }
      }
    }
  );
  assert.equal(out.status, "ok");
  assert.equal(out.artifacts.mentions.length, 1);
  assert.equal(out.artifacts.mentions[0].id, "m1");
});

test("teams review_my_day falls back when getAllMessages is unsupported in delegated context", async () => {
  const calls = [];
  const agent = new TeamsAgent();
  const out = await agent.execute(
    {
      requestId: "t4",
      schemaVersion: "1.0.0",
      agent: "ms.teams",
      action: "review_my_day",
      params: { top: 5, surface: "chats", window: "7d", depth: "fast" }
    },
    {
      graphClient: {
        async get(path) {
          calls.push(path);
          if (path.startsWith("/me/chats/getAllMessages")) {
            throw new Error(
              "Graph GET /me/chats/getAllMessages failed: 412 {\"error\":{\"code\":\"PreconditionFailed\",\"message\":\"not supported in delegated context\"}}"
            );
          }
          if (path.startsWith("/me/chats?")) {
            return { value: [{ id: "c1", topic: "Ops" }] };
          }
          if (path.startsWith("/me/chats/c1/messages")) {
            return {
              value: [{ id: "x", bodyPreview: "urgent review needed", createdDateTime: "2026-03-04T00:00:00Z" }]
            };
          }
          return { value: [] };
        }
      }
    }
  );

  assert.equal(out.status, "ok");
  assert.equal(calls.some((p) => p.startsWith("/me/chats?")), true);
  assert.equal(out.artifacts.prioritized[0].id, "x");
  assert.equal(Array.isArray(out.artifacts.limitations), true);
});

test("teams search_messages prioritizes team/channel names matching query", async () => {
  const agent = new TeamsAgent();
  const out = await agent.execute(
    {
      requestId: "t5",
      schemaVersion: "1.0.0",
      agent: "ms.teams",
      action: "search_messages",
      params: { query: "valeo", top: 1, surface: "channels", window: "all", depth: "balanced" }
    },
    {
      graphClient: {
        async get(path) {
          if (path.startsWith("/me/joinedTeams")) {
            return {
              value: [
                { id: "t1", displayName: "Hoplite Consulting" },
                { id: "t2", displayName: "Valeo Penetration Test" }
              ]
            };
          }
          if (path.startsWith("/teams/t1/channels/c1/messages")) {
            return { value: [{ id: "m1", body: { content: "<p>generic status</p>" }, createdDateTime: isoHoursAgo(4) }] };
          }
          if (path.startsWith("/teams/t2/channels/c2/messages")) {
            return {
              value: [{ id: "m2", body: { content: "<p>valeo update for milestone</p>" }, createdDateTime: isoHoursAgo(1) }]
            };
          }
          if (path.startsWith("/teams/t1/channels")) return { value: [{ id: "c1", displayName: "General" }] };
          if (path.startsWith("/teams/t2/channels")) return { value: [{ id: "c2", displayName: "General" }] };
          return { value: [] };
        }
      }
    }
  );

  assert.equal(out.status, "ok");
  assert.equal(out.artifacts.hits.length, 1);
  assert.equal(out.artifacts.hits[0].id, "m2");
});

test("teams search_messages returns workspace fallback matches when message hits are empty", async () => {
  const agent = new TeamsAgent();
  const out = await agent.execute(
    {
      requestId: "t6",
      schemaVersion: "1.0.0",
      agent: "ms.teams",
      action: "search_messages",
      params: { query: "valeo", top: 30, surface: "channels", window: "all", depth: "balanced" }
    },
    {
      graphClient: {
        async get(path) {
          if (path.startsWith("/me/joinedTeams")) return { value: [{ id: "t2", displayName: "Valeo Penetration Test" }] };
          if (path.startsWith("/teams/t2/channels/c2/messages")) {
            throw new Error("Graph channel read failed");
          }
          if (path.startsWith("/teams/t2/channels")) return { value: [{ id: "c2", displayName: "General" }] };
          return { value: [] };
        }
      }
    }
  );

  assert.equal(out.status, "ok");
  assert.equal(out.artifacts.hits.length, 0);
  assert.equal(Array.isArray(out.artifacts.fallbackMatches), true);
  assert.equal(out.artifacts.fallbackMatches.length > 0, true);
  assert.match(String(out.artifacts.fallbackMatches[0].label).toLowerCase(), /valeo/);
});

test("teams search_messages honors team/channel scope filters", async () => {
  const agent = new TeamsAgent();
  const out = await agent.execute(
    {
      requestId: "t7",
      schemaVersion: "1.0.0",
      agent: "ms.teams",
      action: "search_messages",
      params: {
        query: "status",
        top: 10,
        surface: "channels",
        window: "all",
        depth: "balanced",
        team: "target team",
        channel: "general"
      }
    },
    {
      graphClient: {
        async get(path) {
          if (path.startsWith("/me/joinedTeams")) {
            return {
              value: [
                { id: "t1", displayName: "Other Team" },
                { id: "t2", displayName: "Target Team" }
              ]
            };
          }
          if (path.startsWith("/teams/t2/channels/c2/messages")) {
            return { value: [{ id: "m-good", body: { content: "<p>status report</p>" }, createdDateTime: isoHoursAgo(1) }] };
          }
          if (path.startsWith("/teams/t2/channels/c3/messages")) {
            return { value: [{ id: "m-bad", body: { content: "<p>status random</p>" }, createdDateTime: isoHoursAgo(1) }] };
          }
          if (path.startsWith("/teams/t1/channels/c1/messages")) {
            return { value: [{ id: "m-other", body: { content: "<p>status other</p>" }, createdDateTime: isoHoursAgo(1) }] };
          }
          if (path.startsWith("/teams/t1/channels")) return { value: [{ id: "c1", displayName: "General" }] };
          if (path.startsWith("/teams/t2/channels")) {
            return { value: [{ id: "c2", displayName: "General" }, { id: "c3", displayName: "Random" }] };
          }
          return { value: [] };
        }
      }
    }
  );

  assert.equal(out.status, "ok");
  assert.equal(out.artifacts.hits.length >= 1, true);
  assert.equal(out.artifacts.hits.some((h) => h.id === "m-good"), true);
  assert.equal(out.artifacts.hits.some((h) => h.id === "m-other" || h.id === "m-bad"), false);
});
