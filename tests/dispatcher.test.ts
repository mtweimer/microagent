// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";

import { Dispatcher } from "../src/core/dispatcher.js";
import { InMemoryTranslationCache } from "../src/core/cache.js";
import { StructuredTurnMemory } from "../src/core/memory.js";
import { OutlookAgent } from "../src/agents/ms/outlookAgent.js";
import { CalendarAgent } from "../src/agents/ms/calendarAgent.js";

test("dispatcher routes calendar intent to typed action", async () => {
  const dispatcher = new Dispatcher({
    agents: [new OutlookAgent(), new CalendarAgent()],
    memory: new StructuredTurnMemory(),
    cache: new InMemoryTranslationCache()
  });

  const out = await dispatcher.route("Schedule a meeting tomorrow at 3pm");
  assert.equal(out.status, "error");
  assert.equal(out.artifacts.action.agent, "ms.calendar");
  assert.equal(out.artifacts.action.action, "schedule_event");
});

test("dispatcher serves identical second request from cache", async () => {
  const cache = new InMemoryTranslationCache();
  const graphClient = {
    async get(path) {
      if (path.startsWith("/me/messages")) return { value: [] };
      if (path.startsWith("/me/calendarView")) return { value: [] };
      return {};
    },
    async post() {
      return { ok: true };
    }
  };
  const dispatcher = new Dispatcher({
    agents: [new OutlookAgent(), new CalendarAgent()],
    memory: new StructuredTurnMemory(),
    cache,
    graphClient
  });

  await dispatcher.route("search my email for invoices");
  const second = await dispatcher.route("search my email for invoices");
  assert.equal(second.trace.cacheHit, true);
  assert.equal(cache.stats().hits, 1);
});

test("dispatcher treats declarative past-tense statement as memory context", async () => {
  const dispatcher = new Dispatcher({
    agents: [new OutlookAgent(), new CalendarAgent()],
    memory: new StructuredTurnMemory(),
    cache: new InMemoryTranslationCache()
  });

  const out = await dispatcher.route("Kevin sent email to Satya about new AI models.");
  assert.equal(out.status, "ok");
  assert.equal(out.artifacts.intent, "memory_statement");
});

test("dispatcher maps outlook search prompt to search_email action", async () => {
  const dispatcher = new Dispatcher({
    agents: [new OutlookAgent(), new CalendarAgent()],
    memory: new StructuredTurnMemory(),
    cache: new InMemoryTranslationCache()
  });

  const out = await dispatcher.route("search my email for invoices from microsoft");
  assert.equal(out.artifacts.action.agent, "ms.outlook");
  assert.equal(out.artifacts.action.action, "search_email");
});

test("dispatcher maps unread messages prompt to search_email (not read_email)", async () => {
  const dispatcher = new Dispatcher({
    agents: [new OutlookAgent(), new CalendarAgent()],
    memory: new StructuredTurnMemory(),
    cache: new InMemoryTranslationCache(),
    graphClient: {
      async get() {
        return { value: [] };
      }
    }
  });

  const out = await dispatcher.route("search my email for unread messages today");
  assert.equal(out.status, "ok");
  assert.equal(out.artifacts.action.agent, "ms.outlook");
  assert.equal(out.artifacts.action.action, "search_email");
});

test("dispatcher does not serve cached error response", async () => {
  const cache = new InMemoryTranslationCache();
  const dispatcher = new Dispatcher({
    agents: [new OutlookAgent(), new CalendarAgent()],
    memory: new StructuredTurnMemory(),
    cache
  });

  const first = await dispatcher.route("what's on my calendar for today");
  const second = await dispatcher.route("what's on my calendar for today");

  assert.equal(first.status, "error");
  assert.equal(second.status, "error");
  assert.equal(second.trace.cacheHit, false);
});

test("dispatcher handles no-domain prompts as general chat via composer path", async () => {
  const dispatcher = new Dispatcher({
    agents: [new OutlookAgent(), new CalendarAgent()],
    memory: new StructuredTurnMemory(),
    cache: new InMemoryTranslationCache()
  });

  const out = await dispatcher.route("what's your name and can you tell me more about you?");
  assert.equal(out.status, "ok");
  assert.equal(out.trace.agent, "composer");
  assert.equal(out.conversationMode, "chat");
});

test("dispatcher keeps conversational follow-ups in chat mode", async () => {
  const dispatcher = new Dispatcher({
    agents: [new OutlookAgent(), new CalendarAgent()],
    memory: new StructuredTurnMemory(),
    cache: new InMemoryTranslationCache()
  });

  const out = await dispatcher.route("yeah i want to know your purpose and why we are chatting");
  assert.equal(out.status, "ok");
  assert.equal(out.conversationMode, "chat");
});

test("dispatcher declines unsupported capability requests", async () => {
  const dispatcher = new Dispatcher({
    agents: [new OutlookAgent(), new CalendarAgent()],
    memory: new StructuredTurnMemory(),
    cache: new InMemoryTranslationCache()
  });

  const out = await dispatcher.route("what's the weather like right now?");
  assert.equal(out.status, "unsupported");
  assert.equal(out.capabilityGrounded, true);
  assert.equal(Array.isArray(out.artifacts.unsupported.alternatives), true);
});

test("dispatcher attaches retrieval plan for outlook retrieval", async () => {
  const dispatcher = new Dispatcher({
    agents: [new OutlookAgent(), new CalendarAgent()],
    memory: new StructuredTurnMemory(),
    cache: new InMemoryTranslationCache(),
    graphClient: {
      async get() {
        return { value: [] };
      }
    }
  });

  const out = await dispatcher.route("fetch my latest 2 emails");
  assert.equal(out.status, "ok");
  assert.equal(out.retrievalPlan?.domain, "outlook");
  assert.equal(out.retrievalPlan?.action, "list_recent_emails");
});

test("dispatcher resolves read latest email using session refs", async () => {
  const graphClient = {
    async get(path) {
      if (path.startsWith("/me/messages?")) {
        return {
          value: [
            {
              id: "msg-1",
              subject: "Newest",
              from: { emailAddress: { address: "sender@example.com" } },
              receivedDateTime: "2026-03-04T00:00:00Z",
              bodyPreview: "Preview"
            }
          ]
        };
      }
      if (path.startsWith("/me/messages/msg-1")) {
        return {
          id: "msg-1",
          subject: "Newest",
          from: { emailAddress: { address: "sender@example.com" } },
          receivedDateTime: "2026-03-04T00:00:00Z",
          bodyPreview: "Preview",
          body: { content: "Body" }
        };
      }
      return {};
    }
  };

  const dispatcher = new Dispatcher({
    agents: [new OutlookAgent(), new CalendarAgent()],
    memory: new StructuredTurnMemory(),
    cache: new InMemoryTranslationCache(),
    graphClient
  });

  const listOut = await dispatcher.route("fetch my latest emails");
  assert.equal(listOut.status, "ok");
  const readOut = await dispatcher.route("read the latest one");
  assert.equal(readOut.status, "ok");
  assert.equal(readOut.artifacts.action.action, "read_email");
  assert.equal(readOut.artifacts.result.id, "msg-1");
});

test("dispatcher can summarize latest email from contextual follow-up", async () => {
  const graphClient = {
    async get(path) {
      if (path.startsWith("/me/messages?")) {
        return {
          value: [
            {
              id: "msg-2",
              subject: "Latest",
              from: { emailAddress: { address: "sender@example.com" } },
              receivedDateTime: "2026-03-04T00:00:00Z",
              bodyPreview: "Preview"
            }
          ]
        };
      }
      if (path.startsWith("/me/messages/msg-2")) {
        return {
          id: "msg-2",
          subject: "Latest",
          from: { emailAddress: { address: "sender@example.com" } },
          receivedDateTime: "2026-03-04T00:00:00Z",
          bodyPreview: "Preview",
          body: { content: "Full body" }
        };
      }
      return {};
    }
  };

  const dispatcher = new Dispatcher({
    agents: [new OutlookAgent(), new CalendarAgent()],
    memory: new StructuredTurnMemory(),
    cache: new InMemoryTranslationCache(),
    graphClient
  });

  await dispatcher.route("read my last email for me");
  const out = await dispatcher.route("what was that email about, could you summarize it?");
  assert.equal(out.status, "ok");
  assert.equal(out.artifacts.action.agent, "ms.outlook");
  assert.equal(out.artifacts.action.action, "read_email");
  assert.equal(out.artifacts.result.id, "msg-2");
});

test("dispatcher routes 'read my last email' directly to read_email", async () => {
  const graphClient = {
    async get(path) {
      if (path.startsWith("/me/messages/msg-read-direct")) {
        return {
          id: "msg-read-direct",
          subject: "Direct read",
          from: { emailAddress: { address: "sender@example.com" } },
          receivedDateTime: "2026-03-04T00:00:00Z",
          bodyPreview: "Preview",
          body: { content: "Body" }
        };
      }
      if (path.startsWith("/me/messages?")) {
        return {
          value: [
            {
              id: "msg-read-direct",
              subject: "Direct read",
              from: { emailAddress: { address: "sender@example.com" } },
              receivedDateTime: "2026-03-04T00:00:00Z",
              bodyPreview: "Preview"
            }
          ]
        };
      }
      return {};
    }
  };

  const dispatcher = new Dispatcher({
    agents: [new OutlookAgent(), new CalendarAgent()],
    memory: new StructuredTurnMemory(),
    cache: new InMemoryTranslationCache(),
    graphClient
  });

  dispatcher.sessionRefs.outlook.lastEmailId = "msg-read-direct";
  const out = await dispatcher.route("read my last email for me");
  assert.equal(out.status, "ok");
  assert.equal(out.artifacts.action.action, "read_email");
});

test("dispatcher updates outlook session refs from cached retrieval result", async () => {
  const cache = new InMemoryTranslationCache();
  const graphClient = {
    async get(path) {
      if (path.startsWith("/me/messages?")) {
        return {
          value: [
            {
              id: "msg-cache",
              subject: "Cached",
              from: { emailAddress: { address: "sender@example.com" } },
              receivedDateTime: "2026-03-04T00:00:00Z",
              bodyPreview: "Preview"
            }
          ]
        };
      }
      if (path.startsWith("/me/messages/msg-cache")) {
        return {
          id: "msg-cache",
          subject: "Cached",
          from: { emailAddress: { address: "sender@example.com" } },
          receivedDateTime: "2026-03-04T00:00:00Z",
          bodyPreview: "Preview",
          body: { content: "Full body" }
        };
      }
      return {};
    }
  };
  const dispatcher = new Dispatcher({
    agents: [new OutlookAgent(), new CalendarAgent()],
    memory: new StructuredTurnMemory(),
    cache,
    graphClient
  });

  await dispatcher.route("read my last email for me");
  await dispatcher.route("read my last email for me");
  const out = await dispatcher.route("summarize that email");
  assert.equal(out.status, "ok");
  assert.equal(out.artifacts.action.action, "read_email");
  assert.equal(out.artifacts.result.id, "msg-cache");
});

test("dispatcher resolves 'what did they want' as latest email follow-up", async () => {
  const graphClient = {
    async get(path) {
      if (path.startsWith("/me/messages?")) {
        return {
          value: [
            {
              id: "msg-followup",
              subject: "Follow-up",
              from: { emailAddress: { address: "sender@example.com" } },
              receivedDateTime: "2026-03-04T00:00:00Z",
              bodyPreview: "Preview"
            }
          ]
        };
      }
      if (path.startsWith("/me/messages/msg-followup")) {
        return {
          id: "msg-followup",
          subject: "Follow-up",
          from: { emailAddress: { address: "sender@example.com" } },
          receivedDateTime: "2026-03-04T00:00:00Z",
          bodyPreview: "Preview",
          body: { content: "Full body" }
        };
      }
      return {};
    }
  };

  const dispatcher = new Dispatcher({
    agents: [new OutlookAgent(), new CalendarAgent()],
    memory: new StructuredTurnMemory(),
    cache: new InMemoryTranslationCache(),
    graphClient
  });

  await dispatcher.route("could you read my last email for me?");
  const out = await dispatcher.route("what did they want?");
  assert.equal(out.status, "ok");
  assert.equal(out.artifacts.action.agent, "ms.outlook");
  assert.equal(out.artifacts.action.action, "read_email");
  assert.equal(out.artifacts.result.id, "msg-followup");
});

test("dispatcher routes teams retrieval to scaffolded teams agent", async () => {
  const dispatcher = new Dispatcher({
    agents: [new OutlookAgent(), new CalendarAgent(), {
      id: "ms.teams",
      description: "Teams actions (scaffold)",
      async canHandle(envelope) {
        return envelope?.agent === "ms.teams";
      },
      async execute() {
        return {
          status: "error",
          message: "Teams agent is scaffolded but not implemented yet."
        };
      }
    }],
    memory: new StructuredTurnMemory(),
    cache: new InMemoryTranslationCache()
  });

  const out = await dispatcher.route("search teams for project phoenix updates");
  assert.equal(out.status, "error");
  assert.equal(out.artifacts.action.agent, "ms.teams");
});
