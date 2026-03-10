import test from "node:test";
import assert from "node:assert/strict";

import { StructuredTurnMemory } from "../src/core/memory.js";

test("structured memory recalls relevant turns by term overlap", () => {
  const memory = new StructuredTurnMemory();
  memory.addTurn({ role: "user", text: "Talked about Atomic Habits and Deep Work", source: "test" });
  memory.addTurn({ role: "assistant", text: "Added books to list", source: "test" });

  const result = memory.query("What did we say about Deep Work?", { topK: 1 });
  assert.equal(result.results.length, 1);
  assert.match(String(result.results[0]?.text), /Deep Work/);
});
