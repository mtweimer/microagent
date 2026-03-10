import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { TeamsIndex } from "../src/core/teamsIndex.js";

function tmpDb(name: string): string {
  const dir = path.resolve(process.cwd(), "tmp");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
}

test("teams index syncFromGraph stores messages and supports scoped search", async () => {
  const dbPath = tmpDb("teams-index");
  const index = new TeamsIndex({ dbPath, retentionDays: 180 });
  const now = new Date().toISOString();
  const graph = {
    async get(endpoint: string) {
      if (endpoint.startsWith("/me/chats/getAllMessages")) {
        return {
          value: [
            {
              id: "chat-1",
              createdDateTime: now,
              bodyPreview: "ksm status update",
              from: { user: { displayName: "Alex" } },
              chatId: "chat-a",
              summary: "KSM thread"
            }
          ]
        };
      }
      if (endpoint.startsWith("/me/joinedTeams")) return { value: [] };
      return { value: [] };
    }
  };

  const sync = await index.syncFromGraph(graph, {
    top: 20,
    window: "all",
    surface: "both",
    depth: "deep"
  });
  assert.equal(sync.status, "ok");

  const hit = index.searchMessages({
    query: "ksm",
    top: 10,
    window: "all",
    surface: "chats",
    team: "",
    channel: ""
  });
  assert.equal(hit.messages.length >= 1, true);
  assert.equal(hit.messages[0]?.id, "chat-1");

  const miss = index.searchMessages({
    query: "ksm",
    top: 10,
    window: "all",
    surface: "channels",
    team: "",
    channel: ""
  });
  assert.equal(miss.messages.length, 0);

  const status = index.getStatus();
  assert.equal(status.messages >= 1, true);
  assert.equal(status.backend, "sqlite_fts5");
});

test("teams index delta sync records delta metrics", async () => {
  const dbPath = tmpDb("teams-index-delta");
  const index = new TeamsIndex({ dbPath, retentionDays: 180, deltaLookbackHours: 6 });
  const now = new Date().toISOString();
  const graph = {
    async get(endpoint: string) {
      if (endpoint.startsWith("/me/chats/getAllMessages")) {
        return {
          value: [
            {
              id: "chat-delta-1",
              createdDateTime: now,
              bodyPreview: "delta update",
              from: { user: { displayName: "Alex" } },
              chatId: "chat-delta",
              summary: "Delta thread"
            }
          ]
        };
      }
      if (endpoint.startsWith("/me/joinedTeams")) return { value: [] };
      return { value: [] };
    }
  };

  const sync = await index.syncFromGraph(graph, {
    mode: "delta",
    top: 50,
    surface: "both",
    depth: "balanced",
    window: "all"
  });
  assert.equal(sync.status, "ok");
  assert.equal(sync.mode, "delta");
  assert.equal(typeof sync.deltaSince, "string");

  const status = index.getStatus();
  assert.equal(status.lastSyncMode, "delta");
  assert.equal(status.lastIndexed >= 1, true);
});
