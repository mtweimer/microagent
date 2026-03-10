// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";

import { listProfiles, loadProfile, validateProfile } from "../src/core/profile.js";

test("default profile exists and validates", () => {
  const profiles = listProfiles();
  assert.ok(profiles.includes("default"));

  const { profile } = loadProfile("default");
  const validation = validateProfile(profile);
  assert.equal(validation.ok, true);
});

test("profile validation rejects non-string agent paths", () => {
  const base = loadProfile("default").profile;
  const validation = validateProfile({
    ...base,
    agents: {
      ...base.agents,
      paths: [123]
    }
  });
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join(" "), /agents\.paths/);
});
