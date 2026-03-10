#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { ACTION_REGISTRY_VERSION, ACTION_REGISTRY, listDomains } from "../src/contracts/actionRegistry.js";
import type { DomainName } from "../src/contracts/actionRegistry.js";

const root = process.cwd();

function expected(shortName: string, domain: DomainName): string {
  const cfg = ACTION_REGISTRY[domain];
  return JSON.stringify(
    {
      generatedFrom: "src/contracts/actionRegistry.js",
      registryVersion: ACTION_REGISTRY_VERSION,
      domain,
      agentId: cfg.agentId,
      requiredScopes: cfg.requiredScopes,
      actions: cfg.actions
    },
    null,
    2
  ) + "\n";
}

function checkOne(shortName: string, domain: DomainName): { ok: boolean; reason: string } {
  const filePath = path.join(root, "src", "agents", "ms", `${shortName}.schema.generated.json`);
  if (!fs.existsSync(filePath)) {
    return { ok: false, reason: `missing file ${filePath}` };
  }
  const actual = fs.readFileSync(filePath, "utf8");
  const exp = expected(shortName, domain);
  return {
    ok: actual === exp,
    reason: actual === exp ? "ok" : `drift detected in ${filePath}`
  };
}

const checks = listDomains()
  .filter((domain) => ACTION_REGISTRY[domain]?.agentId?.startsWith("ms."))
  .map((domain) => {
    const shortName = ACTION_REGISTRY[domain].agentId.split(".").pop() ?? domain;
    return { shortName, domain, ...checkOne(shortName, domain) };
  });

const failed = checks.filter((c) => !c.ok);
console.log(JSON.stringify({ checks }, null, 2));
if (failed.length) process.exit(1);
