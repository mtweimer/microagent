import test from "node:test";
import assert from "node:assert/strict";

import { Dispatcher } from "../src/core/dispatcher.js";
import { TeamsAgent } from "../src/agents/teams/index.js";
import { makeDispatcherDeps } from "./helpers.js";
import type { ActionEnvelope } from "../src/core/contracts.js";

test("dispatcher routes missed-in-teams prompt to review_my_day", async () => {
  const dispatcher = new Dispatcher({
    ...makeDispatcherDeps({
      agents: [new TeamsAgent()],
      graphClient: {
      async get() {
        return { value: [] };
      }
      }
    })
  });

  const out = await dispatcher.route("did I miss anything in teams today?");
  const action = out.artifacts.action as ActionEnvelope;
  assert.equal(out.status, "ok");
  assert.equal(action.agent, "ms.teams");
  assert.equal(action.action, "review_my_day");
});

test("dispatcher routes teams query to search_messages", async () => {
  const dispatcher = new Dispatcher({
    ...makeDispatcherDeps({
      agents: [new TeamsAgent()],
      graphClient: {
      async get() {
        return {
          value: [
            { id: "x1", bodyPreview: "project phoenix update", createdDateTime: "2026-03-04T00:00:00Z" }
          ]
        };
      }
      }
    })
  });

  const out = await dispatcher.route("search teams for phoenix");
  const action = out.artifacts.action as ActionEnvelope;
  assert.equal(out.status, "ok");
  assert.equal(action.agent, "ms.teams");
  assert.equal(action.action, "search_messages");
});

test("dispatcher strips teams directive tokens from search query", async () => {
  const dispatcher = new Dispatcher({
    ...makeDispatcherDeps({
      agents: [new TeamsAgent()],
      graphClient: {
      async get() {
        return { value: [] };
      }
      }
    })
  });

  const out = await dispatcher.route("search teams for valeo window=all surface=both depth=balanced top=30");
  const action = out.artifacts.action as ActionEnvelope;
  assert.equal(out.status, "ok");
  assert.equal(action.agent, "ms.teams");
  assert.equal(action.action, "search_messages");
  assert.equal(String(action.params.query), "valeo");
  assert.equal(String(action.params.window), "all");
});

test("dispatcher routes mention prompt to search_mentions", async () => {
  const dispatcher = new Dispatcher({
    ...makeDispatcherDeps({
      agents: [new TeamsAgent()],
      graphClient: {
      async get() {
        return { value: [] };
      }
      }
    })
  });

  const out = await dispatcher.route("did anyone mention me in teams today?");
  const action = out.artifacts.action as ActionEnvelope;
  assert.equal(out.status, "ok");
  assert.equal(action.agent, "ms.teams");
  assert.equal(action.action, "search_mentions");
});
