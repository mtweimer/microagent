import test from "node:test";
import assert from "node:assert/strict";

import { runReviewOrchestrator } from "../src/core/reviewOrchestrator.js";
import { buildTriageItems } from "../src/core/triageClassifier.js";

test("review orchestrator builds narrative and triage items", async () => {
  const outputs = new Map([
    [
      "what's on my calendar for today",
      {
        status: "ok",
        finalText: "Found 1 event.",
        artifacts: {
          action: { agent: "ms.calendar", action: "find_events" },
          result: {
            timeRange: "today",
            events: [
              {
                subject: "Client Review",
                start: { dateTime: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
                isOnlineMeeting: true,
                webLink: "https://example.com/event"
              }
            ]
          }
        },
        suggestedActions: []
      }
    ],
    [
      "search my email for unread messages today",
      {
        status: "ok",
        finalText: "Found 1 email.",
        artifacts: {
          action: { agent: "ms.outlook", action: "search_email" },
          result: {
            messages: [
              {
                id: "msg-1",
                subject: "Need review today",
                from: "alex@example.com",
                receivedDateTime: new Date().toISOString()
              }
            ]
          }
        },
        suggestedActions: []
      }
    ],
    [
      "did i miss anything in teams today?",
      {
        status: "ok",
        finalText: "Reviewed Teams.",
        artifacts: {
          action: { agent: "ms.teams", action: "review_my_day" },
          result: {
            prioritized: [
              {
                id: "t1",
                from: "Matthew Guzek",
                teamName: "Hoplite",
                channelName: "General",
                bodyPreview: "Please review the latest update today."
              }
            ]
          }
        },
        suggestedActions: []
      }
    ]
  ]);

  const dispatcher = {
    agents: [{ id: "ms.calendar" }, { id: "ms.outlook" }, { id: "ms.teams" }],
    sessionRefs: {},
    async route(prompt) {
      return outputs.get(prompt);
    }
  };

  const out = await runReviewOrchestrator({ target: "today", dispatcher });
  assert.equal(out.status, "ok");
  assert.match(out.finalText, /reviewed your day/i);
  assert.equal(Array.isArray(out.artifacts.triageItems), true);
  assert.equal(out.artifacts.triageItems.length >= 2, true);
  assert.equal(out.suggestedActions.some((item) => item.actionEnvelope?.action === "read_email"), true);
});

test("review orchestrator filters triage items for focused client review", async () => {
  const outputs = new Map([
    [
      "search my email for Valeo",
      {
        status: "ok",
        finalText: "Found 2 emails.",
        artifacts: {
          action: { agent: "ms.outlook", action: "search_email" },
          result: {
            messages: [
              {
                id: "msg-1",
                subject: "Valeo kickoff follow up",
                from: "alex@example.com",
                receivedDateTime: new Date().toISOString()
              },
              {
                id: "msg-2",
                subject: "Unrelated note",
                from: "other@example.com",
                receivedDateTime: new Date().toISOString()
              }
            ]
          }
        },
        suggestedActions: []
      }
    ],
    [
      "what's on my calendar for today",
      {
        status: "ok",
        finalText: "Found 1 event.",
        artifacts: {
          action: { agent: "ms.calendar", action: "find_events" },
          result: { timeRange: "today", events: [] }
        },
        suggestedActions: []
      }
    ],
    [
      "search teams for Valeo",
      {
        status: "ok",
        finalText: "Found 1 message.",
        artifacts: {
          action: { agent: "ms.teams", action: "search_messages" },
          result: {
            hits: [
              {
                id: "t1",
                from: "Matthew",
                teamName: "Hoplite <> Valeo",
                channelName: "General",
                bodyPreview: "Please review the Valeo items today."
              }
            ]
          }
        },
        suggestedActions: []
      }
    ]
  ]);
  const dispatcher = {
    agents: [{ id: "ms.calendar" }, { id: "ms.outlook" }, { id: "ms.teams" }],
    sessionRefs: {},
    async route(prompt) {
      return outputs.get(prompt);
    }
  };
  const entityGraph = {
    aliasesFor(name) {
      return [name];
    },
    observeExecution() {}
  };
  const out = await runReviewOrchestrator({
    target: "today",
    dispatcher,
    entityGraph,
    focus: { kind: "client", name: "Valeo" }
  });
  assert.match(out.finalText, /client 'Valeo'/i);
  assert.equal(out.artifacts.triageItems.length, 2);
  assert.equal(out.artifacts.triageItems.every((item) => /valeo/i.test(JSON.stringify(item))), true);
});

test("triage classifier boosts email and teams items when they overlap with calendar context", () => {
  const items = buildTriageItems([
    {
      artifacts: {
        action: { agent: "ms.calendar", action: "find_events" },
        result: {
          events: [
            {
              subject: "Valeo Review",
              start: { dateTime: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
              isOnlineMeeting: true,
              webLink: "https://example.com/v"
            }
          ]
        }
      }
    },
    {
      artifacts: {
        action: { agent: "ms.outlook", action: "search_email" },
        result: {
          messages: [
            {
              id: "msg-ctx-1",
              subject: "Valeo follow up needed",
              from: "alex@example.com"
            }
          ]
        }
      }
    },
    {
      artifacts: {
        action: { agent: "ms.teams", action: "search_messages" },
        result: {
          hits: [
            {
              id: "team-ctx-1",
              from: "Matthew",
              teamName: "Valeo Project",
              channelName: "General",
              bodyPreview: "Please review the Valeo changes."
            }
          ]
        }
      }
    }
  ]);
  const emailItem = items.find((item) => item.sourceDomain === "outlook");
  const teamsItem = items.find((item) => item.sourceDomain === "teams");
  assert.match(emailItem.rationale, /current meeting\/client context/i);
  assert.match(teamsItem.rationale, /active client\/project context/i);
});
