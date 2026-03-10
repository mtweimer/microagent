import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { FileBackedPatternCache } from "../src/core/patternCache.js";

const FILE = "./data/test-pattern-cache.json";

test("pattern cache learns and retrieves normalized request pattern", () => {
  if (fs.existsSync(FILE)) fs.unlinkSync(FILE);
  const cache = new FileBackedPatternCache(FILE);
  cache.learn("search my email for invoices", "outlook", {
    agent: "ms.outlook",
    action: "search_email",
    params: { query: "search my email for invoices" },
    schemaVersion: "1.0.0"
  });

  const hit = cache.lookup("find my email for invoices", "outlook");
  assert.equal(hit.action, "search_email");
  if (fs.existsSync(FILE)) fs.unlinkSync(FILE);
});

