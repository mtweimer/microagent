import test from "node:test";
import assert from "node:assert/strict";

import { parseDotEnv } from "../src/core/env.js";

test("parseDotEnv parses keys and strips wrapping quotes", () => {
  const parsed = parseDotEnv(`\n# comment\nA=1\nB="two"\nC='three'\n`);
  assert.deepEqual(parsed, {
    A: "1",
    B: "two",
    C: "three"
  });
});
