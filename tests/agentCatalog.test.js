import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createDefaultAgents,
  discoverAgentManifests,
  getAgentCatalog
} from "../src/agents/catalog.js";
import { ACTION_REGISTRY } from "../src/contracts/actionRegistry.js";

test("default agent manifests align with action registry domains", async () => {
  const agents = await createDefaultAgents();
  const domainByAgentId = Object.fromEntries(
    Object.entries(ACTION_REGISTRY).map(([domain, cfg]) => [cfg.agentId, domain])
  );

  for (const agent of agents) {
    if (!domainByAgentId[agent.id]) continue;
    const manifest = agent.manifest;
    assert.ok(manifest, `agent ${agent.id} should expose manifest`);
    const manifestAgentId = manifest.agentId ?? manifest.id;
    assert.equal(manifestAgentId, agent.id, `manifest id should match agent id for ${agent.id}`);
    const domain = domainByAgentId[agent.id];
    assert.ok(domain, `domain should exist for ${agent.id}`);
    const registryActions = Object.keys(ACTION_REGISTRY[domain].actions);
    assert.deepEqual(
      [...manifest.actions].sort(),
      [...registryActions].sort(),
      `manifest actions should match registry for ${agent.id}`
    );
  }
});

test("manifest discovery includes planned scaffold packages", () => {
  const manifests = discoverAgentManifests();
  const ids = new Set(manifests.map((m) => m.id));
  assert.equal(ids.has("ms.outlook"), true);
  assert.equal(ids.has("ms.calendar"), true);
  assert.equal(ids.has("ms.teams"), true);
  assert.equal(ids.has("ms.sharepoint"), true);
  assert.equal(ids.has("ms.onedrive"), true);
  assert.equal(ids.has("local.system"), true);
});

test("external plugin agent loads from custom agent path without catalog edits", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "micro-claw-agent-"));
  const pluginDir = path.join(root, "echo-agent");
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, "manifest.json"),
    JSON.stringify(
      {
        agentId: "custom.echo",
        domain: "custom",
        actions: ["echo_text"],
        entry: "./index.js"
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(pluginDir, "index.js"),
    [
      "export default function createAgent() {",
      "  return {",
      "    id: 'custom.echo',",
      "    description: 'Echo plugin',",
      "    manifest: { agentId: 'custom.echo', actions: ['echo_text'] },",
      "    async canHandle(envelope) { return envelope?.agent === 'custom.echo'; },",
      "    async execute() { return { status: 'ok', message: 'echo' }; }",
      "  };",
      "}"
    ].join("\n")
  );

  const agents = await createDefaultAgents({
    agentPaths: [root],
    enabled: ["custom.echo"]
  });
  assert.equal(agents.length, 1);
  assert.equal(agents[0].id, "custom.echo");

  const catalog = await getAgentCatalog({ agentPaths: [root] });
  const plugin = catalog.find((row) => row.id === "custom.echo");
  assert.ok(plugin);
  assert.equal(plugin.implemented, true);
});
