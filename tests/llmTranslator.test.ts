import test from "node:test";
import assert from "node:assert/strict";

import { translateRequest } from "../src/core/llmTranslator.js";
import { makeModelGateway } from "./helpers.js";

test("translateRequest uses model output when valid", async () => {
  const gateway = makeModelGateway({
    getActiveProvider() {
      return "openai";
    },
    async completeJson() {
      return {
        action: "schedule_event",
        params: { title: "Design Review", when: "tomorrow", attendees: ["alex@example.com"] },
        confidence: 0.91,
        requiresConfirmation: false,
        schemaVersion: "1.0.0"
      };
    }
  });

  const result = await translateRequest("Schedule design review tomorrow", "calendar", gateway);
  assert.equal(result.source, "llm");
  assert.equal(result.envelope.agent, "ms.calendar");
  assert.equal(result.envelope.action, "schedule_event");
  assert.equal(result.envelope.schemaVersion, "1.0.0");
});

test("translateRequest correction pass recovers invalid first response", async () => {
  let call = 0;
  const gateway = makeModelGateway({
    getActiveProvider() {
      return "openai";
    },
    async completeJson() {
      call += 1;
      if (call === 1) return { action: "invalid_action", params: {} };
      return {
        action: "find_events",
        params: { timeRange: "today" },
        confidence: 0.9,
        requiresConfirmation: false,
        schemaVersion: "1.0.0"
      };
    }
  });

  const result = await translateRequest("What's on my calendar today?", "calendar", gateway);
  assert.equal(result.source, "llm_corrected");
  assert.equal(result.envelope.action, "find_events");
});

test("translateRequest falls back to heuristic when invalid after correction", async () => {
  const gateway = makeModelGateway({
    getActiveProvider() {
      return "openai";
    },
    async completeJson() {
      return { action: "invalid_action", params: {} };
    }
  });

  const result = await translateRequest("Schedule design review tomorrow", "calendar", gateway);
  assert.equal(result.source, "heuristic");
  assert.equal(result.envelope.agent, "ms.calendar");
  assert.equal(result.envelope.schemaVersion, "1.0.0");
});

test("translateRequest disambiguates outlook search prompt from send_email", async () => {
  const gateway = makeModelGateway({
    getActiveProvider() {
      return "openai";
    },
    async completeJson() {
      return {
        action: "send_email",
        params: { to: [], subject: "x", body: "x" },
        confidence: 0.9,
        requiresConfirmation: false,
        schemaVersion: "1.0.0"
      };
    }
  });

  const result = await translateRequest("search my email for invoices from microsoft", "outlook", gateway);
  assert.equal(result.envelope.action, "search_email");
});

test("translateRequest disambiguates outlook follow-up question to read_email", async () => {
  const gateway = makeModelGateway({
    getActiveProvider() {
      return "openai";
    },
    async completeJson() {
      return {
        action: "search_email",
        params: { query: "what did they want?" },
        confidence: 0.9,
        requiresConfirmation: false,
        schemaVersion: "1.0.0"
      };
    }
  });

  const result = await translateRequest("what did they want?", "outlook", gateway);
  assert.equal(result.envelope.action, "read_email");
});

test("translateRequest disambiguates 'read my last email' to read_email", async () => {
  const gateway = makeModelGateway({
    getActiveProvider() {
      return "openai";
    },
    async completeJson() {
      return {
        action: "list_recent_emails",
        params: { limit: 5 },
        confidence: 0.9,
        requiresConfirmation: false,
        schemaVersion: "1.0.0"
      };
    }
  });

  const result = await translateRequest("read my last email for me", "outlook", gateway);
  assert.equal(result.envelope.action, "read_email");
});

test("translateRequest applies teams directive defaults from input", async () => {
  const gateway = makeModelGateway({
    getActiveProvider() {
      return "openai";
    },
    async completeJson() {
      return {
        action: "search_messages",
        params: { query: "valeo" },
        confidence: 0.9,
        requiresConfirmation: false,
        schemaVersion: "1.0.0"
      };
    }
  });

  const result = await translateRequest(
    "search teams for valeo window=all surface=channels depth=fast top=55 team=Sync_-_KSM_<>_Hoplite channel=General",
    "teams",
    gateway
  );
  assert.equal(result.envelope.action, "search_messages");
  assert.equal(result.envelope.params.query, "valeo");
  assert.equal(result.envelope.params.window, "all");
  assert.equal(result.envelope.params.surface, "channels");
  assert.equal(result.envelope.params.depth, "fast");
  assert.equal(result.envelope.params.top, 55);
  assert.equal(result.envelope.params.team, "sync - ksm <> hoplite");
  assert.equal(result.envelope.params.channel, "general");
});

test("translateRequest forces teams query from explicit input phrase", async () => {
  const gateway = makeModelGateway({
    getActiveProvider() {
      return "openai";
    },
    async completeJson() {
      return {
        action: "search_messages",
        params: { query: "vimeo window=all surface=both depth=balanced top=30" },
        confidence: 0.9,
        requiresConfirmation: false,
        schemaVersion: "1.0.0"
      };
    }
  });

  const result = await translateRequest(
    "search teams for valeo window=all surface=both depth=balanced top=30",
    "teams",
    gateway
  );
  assert.equal(result.envelope.action, "search_messages");
  assert.equal(result.envelope.params.query, "valeo");
});
