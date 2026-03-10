import test from "node:test";
import assert from "node:assert/strict";

import { Dispatcher } from "../src/core/dispatcher.js";
import { validateTrace } from "../src/trace/traceSchema.js";
import { OutlookAgent } from "../src/agents/ms/outlookAgent.js";
import { CalendarAgent } from "../src/agents/ms/calendarAgent.js";
import { makeDispatcherDeps } from "./helpers.js";

test("dispatcher emits trace that matches schema", async () => {
  const dispatcher = new Dispatcher(
    makeDispatcherDeps({
      agents: [new OutlookAgent(), new CalendarAgent()]
    })
  );

  const out = await dispatcher.route("schedule meeting tomorrow");
  const check = validateTrace(out.trace);
  assert.equal(check.ok, true);
});
