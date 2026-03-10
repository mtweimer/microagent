import test from "node:test";
import assert from "node:assert/strict";

import { CalendarAgent } from "../src/agents/ms/calendarAgent.js";
import { makeExecutionContext } from "./helpers.js";

test("calendar schedule_event posts graph event with normalized attendees", async () => {
  let postedPath: string | null = null;
  let postedBody: Record<string, unknown> | null = null;
  const graphClient = {
    async post(path: string, body: Record<string, unknown>) {
      postedPath = path;
      postedBody = body;
      return {
        id: "evt-1",
        subject: body.subject,
        start: body.start,
        end: body.end,
        webLink: "https://example.com/event"
      };
    }
  };

  const agent = new CalendarAgent();
  const out = await agent.execute(
    {
      requestId: "r1",
      schemaVersion: "1.0.0",
      agent: "ms.calendar",
      action: "schedule_event",
      params: {
        title: "Project Sync",
        when: "tomorrow at 3pm",
        attendees: [{ emailAddress: { address: "alex@example.com" } }, "sam@example.com"]
      }
    },
    makeExecutionContext({ graphClient })
  );

  assert.equal(out.status, "ok");
  assert.equal(postedPath, "/me/events");
  assert.ok(postedBody);
  const body = postedBody as Record<string, unknown>;
  assert.equal(body.subject as string, "Project Sync");
  assert.equal((body.attendees as unknown[]).length, 2);
});

test("calendar find_events uses calendarView bounded range", async () => {
  let requestedPath: string | null = null;
  const graphClient = {
    async get(path: string) {
      requestedPath = path;
      return { value: [] };
    }
  };

  const agent = new CalendarAgent();
  const out = await agent.execute(
    {
      requestId: "r2",
      schemaVersion: "1.0.0",
      agent: "ms.calendar",
      action: "find_events",
      params: { timeRange: "today" }
    },
    makeExecutionContext({ graphClient })
  );

  assert.equal(out.status, "ok");
  assert.ok(requestedPath);
  assert.match(requestedPath, /^\/me\/calendarView\?/);
  assert.match(requestedPath, /startDateTime=/);
  assert.match(requestedPath, /endDateTime=/);
});
