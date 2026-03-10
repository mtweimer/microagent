// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";

import { parsePluginPathArg, validatePlugins } from "../src/core/pluginValidator.js";
import { loadProfile } from "../src/core/profile.js";

test("parsePluginPathArg splits common separators", () => {
  const out = parsePluginPathArg("/tmp/a,/tmp/b;/tmp/c");
  assert.equal(out.length, 3);
});

test("validatePlugins passes for default profile manifests", async () => {
  const { profile } = loadProfile("default");
  const out = await validatePlugins({ profile, env: process.env });
  assert.equal(out.ok, true);
  assert.equal(out.summary.total >= 1, true);
});
