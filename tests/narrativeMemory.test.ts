// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { NarrativeMemory } from "../src/core/narrativeMemory.js";

const FILE = "./data/test-narrative.jsonl";

test("narrative memory appends and summarizes entries", () => {
  if (fs.existsSync(FILE)) fs.unlinkSync(FILE);
  const memory = new NarrativeMemory(FILE);
  memory.append({ text: "Today: reviewed inbox.", kind: "summary" });
  memory.append({ text: "Follow-up meeting planned.", kind: "summary" });

  const entries = memory.summarize("today", 5);
  assert.equal(entries.length >= 1, true);
  assert.match(entries[0].text, /reviewed|follow-up/i);

  if (fs.existsSync(FILE)) fs.unlinkSync(FILE);
});
