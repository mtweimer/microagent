// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";

import {
  inferActionRisk,
  normalizeRisk,
  riskValue,
  shouldExecuteCase
} from "../src/bench/riskPolicy.js";

test("risk policy normalizes and orders risk levels", () => {
  assert.equal(normalizeRisk("LOW"), "low");
  assert.equal(riskValue("low") < riskValue("medium"), true);
  assert.equal(riskValue("medium") < riskValue("high"), true);
});

test("risk policy infers action risk", () => {
  assert.equal(inferActionRisk({ action: "search_email" }), "low");
  assert.equal(inferActionRisk({ action: "schedule_event" }), "medium");
  assert.equal(inferActionRisk({ action: "send_email" }), "high");
});

test("risk policy blocks high-risk case when allow-risk is low", () => {
  assert.equal(shouldExecuteCase("high", "low"), false);
  assert.equal(shouldExecuteCase("low", "medium"), true);
});
