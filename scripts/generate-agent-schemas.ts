#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { ACTION_REGISTRY_VERSION, ACTION_REGISTRY, listDomains } from "../src/contracts/actionRegistry.js";
import type { DomainName } from "../src/contracts/actionRegistry.js";

const root = process.cwd();

function ensureDir(p: string): void {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function generate(): string[] {
  const out: string[] = [];

  for (const domain of listDomains()) {
    const cfg = ACTION_REGISTRY[domain];
    if (!cfg.agentId.startsWith("ms.")) continue;

    const shortName = cfg.agentId.split(".").pop() ?? (domain as DomainName);

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
