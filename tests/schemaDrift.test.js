import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { ACTION_REGISTRY, ACTION_REGISTRY_VERSION, listDomains } from "../src/contracts/actionRegistry.js";

function readGenerated(shortName) {
  const p = path.resolve(process.cwd(), "src", "agents", "ms", `${shortName}.schema.generated.json`);
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw);
}

for (const domain of listDomains()) {
  const cfg = ACTION_REGISTRY[domain];
  if (!cfg?.agentId?.startsWith("ms.")) continue;
  const shortName = cfg.agentId.split(".").pop();
  test(`generated ${shortName} schema matches registry`, () => {
    const g = readGenerated(shortName);
    assert.equal(g.registryVersion, ACTION_REGISTRY_VERSION);
    assert.equal(g.agentId, cfg.agentId);
    assert.deepEqual(g.actions, cfg.actions);
  });
}
