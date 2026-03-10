// @ts-nocheck
import fs from "node:fs";
import path from "node:path";
import { discoverAgentManifests, getAgentCatalog } from "../agents/catalog.js";
import { ACTION_REGISTRY } from "../contracts/actionRegistry.js";

export async function validatePlugins(options = {}) {
  const manifests = discoverAgentManifests(options);
  const catalog = await getAgentCatalog(options);
  const catalogById = new Map(catalog.map((c) => [c.id, c]));
  const checks = [];

  for (const m of manifests) {
    const id = m.id;
    const row = {
      id,
      packageName: m.packageName,
      manifestPath: m.path,
      ok: true,
      issues: []
    };

    if (!id) row.issues.push("missing agentId/id in manifest");
    if (!Array.isArray(m.manifest?.actions)) row.issues.push("manifest.actions must be array");
    if (!m.entryPath || !fs.existsSync(m.entryPath)) row.issues.push(`entry not found: ${m.entryPath}`);

    const loaded = id ? catalogById.get(id) : null;
    if (id && (!loaded || !loaded.implemented)) {
      row.issues.push(`load failed: ${loaded?.loadError ?? "unknown"}`);
    }

    const domain = findDomainByAgentId(id);
    if (domain) {
      const expected = Object.keys(ACTION_REGISTRY[domain].actions).sort();
      const actual = [...(m.manifest?.actions ?? [])].sort();
      if (JSON.stringify(expected) !== JSON.stringify(actual)) {
        row.issues.push(`manifest actions drift with registry domain '${domain}'`);
      }
    }

    row.ok = row.issues.length === 0;
    checks.push(row);
  }

  const failed = checks.filter((c) => !c.ok);
  return {
    checks,
    summary: {
      total: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length
    },
    ok: failed.length === 0
  };
}

function findDomainByAgentId(agentId) {
  for (const [domain, cfg] of Object.entries(ACTION_REGISTRY)) {
    if (cfg.agentId === agentId) return domain;
  }
  return null;
}

export function parsePluginPathArg(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  return raw
    .split(/[,;:]/)
    .map((v) => v.trim())
    .filter(Boolean)
    .map((p) => path.resolve(p));
}
