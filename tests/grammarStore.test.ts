// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { FileBackedGrammarStore } from "../src/core/grammarStore.js";

const FILE = "./data/test-grammar-store.json";

test("grammar store learns and retrieves by token overlap", () => {
  if (fs.existsSync(FILE)) fs.unlinkSync(FILE);
  const store = new FileBackedGrammarStore(FILE);
  store.learn("search my email for invoices", "outlook", {
    agent: "ms.outlook",
    action: "search_email",
    params: { query: "search my email for invoices" },
    schemaVersion: "1.0.0"
  });

  const hit = store.lookup("find email invoices", "outlook");
  assert.equal(hit.action, "search_email");
  if (fs.existsSync(FILE)) fs.unlinkSync(FILE);
});

