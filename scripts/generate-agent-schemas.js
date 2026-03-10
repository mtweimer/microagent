#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { ACTION_REGISTRY_VERSION, ACTION_REGISTRY, listDomains } from "../src/contracts/actionRegistry.js";

const root = process.cwd();

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function generate() {
  const out = [];

  for (const domain of listDomains()) {
    const cfg = ACTION_REGISTRY[domain];
    if (!cfg.agentId.startsWith("ms.")) continue;

    const shortName = cfg.agentId.split(".").pop();

    const payload = {
      generatedFrom: "src/contracts/actionRegistry.js",
      registryVersion: ACTION_REGISTRY_VERSION,
      domain,
      agentId: cfg.agentId,
      requiredScopes: cfg.requiredScopes,
      actions: cfg.actions
    };

    const filePath = path.join(root, "src", "agents", "ms", `${shortName}.schema.generated.json`);
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + "\n");
    out.push(filePath);
  }

  return out;
}

const files = generate();
console.log(JSON.stringify({ generated: files }, null, 2));
