import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { SQLiteStructuredMemory } from "../src/core/sqliteMemory.js";

const DB_PATH = "./data/test-memory.sqlite";

test("sqlite memory stores and retrieves relation-rich turn", () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

  const mem = new SQLiteStructuredMemory(DB_PATH);
  mem.addTurn({ role: "user", text: "Kevin sent email to Satya about new AI models." });
  mem.addTurn({ role: "assistant", text: "Noted the email thread for follow up." });

  const result = mem.query("Who did Kevin send email to?", { topK: 3 });
  const joined = result.results.map((r) => r.text).join(" ");

  assert.match(joined, /Kevin sent email to Satya/i);

  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
});

test("sqlite memory condenses assistant JSON blobs for retrieval", () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

  const mem = new SQLiteStructuredMemory(DB_PATH);
  mem.addTurn({
    role: "assistant",
    text: JSON.stringify({
      status: "ok",
      message: "Found 5 email(s).",
      artifacts: { action: { agent: "ms.outlook", action: "search_email" } },
      trace: { provider: "ollama", model: "llama3.1" }
    })
  });

  const result = mem.query("search email", { topK: 1 });
  assert.match(result.results[0].text, /assistant_result/);
  assert.ok(result.results[0].text.length < 220);

  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
});
