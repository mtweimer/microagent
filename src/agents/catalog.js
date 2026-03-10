import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const AGENTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const EXCLUDED_DIRS = new Set(["base", "ms"]);

export function discoverAgentManifests(options = {}) {
  const roots = resolveAgentRoots(options);
  const manifests = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      const packageDir = path.join(root, entry.name);
      const manifestPath = path.join(packageDir, "manifest.json");
      if (!fs.existsSync(manifestPath)) continue;
      const raw = fs.readFileSync(manifestPath, "utf8");
      const manifest = JSON.parse(raw);
      const id = manifest.agentId ?? manifest.id ?? null;
      const entryPath = resolveEntryPath(packageDir, manifest);
      manifests.push({
        packageName: entry.name,
        packageDir,
        path: manifestPath,
        id,
        manifest,
        entryPath
      });
    }
  }

  manifests.sort((a, b) => {
    const idCmp = String(a.id ?? "").localeCompare(String(b.id ?? ""));
    if (idCmp !== 0) return idCmp;
    return String(a.path).localeCompare(String(b.path));
  });
  return manifests;
}

export async function createDefaultAgents(options = {}) {
  const manifests = discoverAgentManifests(options);
  const enabled = normalizeEnabledList(options.enabled);
  const includeDisabled = options.includeDisabled === true;
  const agents = [];
  let matchedByEnabled = 0;
  for (const item of manifests) {
    if (!item.id) continue;
    if (!includeDisabled && enabled.size > 0 && !enabled.has(item.id)) continue;
    if (enabled.size > 0 && enabled.has(item.id)) matchedByEnabled += 1;
    const loaded = await loadAgentFromManifest(item);
    if (!loaded?.agent) continue;
    agents.push(loaded.agent);
  }
  if (agents.length === 0 && enabled.size > 0 && matchedByEnabled === 0) {
    for (const item of manifests) {
      const loaded = await loadAgentFromManifest(item);
      if (!loaded?.agent) continue;
      agents.push(loaded.agent);
    }
  }
  return agents;
}

export async function getAgentCatalog(options = {}) {
  const manifests = discoverAgentManifests(options);
  const rows = [];
  for (const item of manifests) {
    const loaded = await loadAgentFromManifest(item);
    rows.push({
      id: item.id,
      packageName: item.packageName,
      description: loaded?.agent?.description ?? null,
      implemented: Boolean(loaded?.agent),
      loadError: loaded?.error ?? null,
      manifest: item.manifest
    });
  }
  return rows;
}

function resolveAgentRoots(options) {
  const roots = [AGENTS_DIR];
  const fromOptions = normalizePathList(options.agentPaths ?? []);
  const fromProfile = normalizePathList(options.profile?.agents?.paths ?? []);
  const fromEnv = normalizePathList(String(options.env?.MICRO_CLAW_AGENT_PATHS ?? ""));
  for (const p of [...fromOptions, ...fromProfile, ...fromEnv]) roots.push(path.resolve(p));
  return [...new Set(roots)];
}

function resolveEntryPath(packageDir, manifest) {
  const rel = typeof manifest.entry === "string" && manifest.entry.trim() ? manifest.entry.trim() : "./index.js";
  return path.resolve(packageDir, rel);
}

function normalizeEnabledList(enabled) {
  if (!Array.isArray(enabled)) return new Set();
  return new Set(enabled.map((x) => String(x)));
}

function normalizePathList(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map((v) => String(v));
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  return raw
    .split(/[,;:]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

async function loadAgentFromManifest(item) {
  try {
    if (!item?.entryPath || !fs.existsSync(item.entryPath)) {
      return { agent: null, error: `entry not found: ${item?.entryPath ?? "unknown"}` };
    }
    const mod = await import(pathToFileURL(item.entryPath).href);
    const agent = instantiateAgent(mod, item);
    if (!agent) return { agent: null, error: "no compatible export found" };
    if (item.id && agent.id !== item.id) {
      return { agent: null, error: `agent id mismatch: manifest=${item.id}, module=${agent.id}` };
    }
    return { agent, error: null };
  } catch (error) {
    return { agent: null, error: String(error?.message ?? error) };
  }
}

function instantiateAgent(mod, item) {
  const manifest = item?.manifest ?? {};
  const exportName = String(manifest.exportName ?? "").trim();
  if (exportName && mod[exportName]) {
    return materialize(mod[exportName]);
  }
  if (typeof mod.createAgent === "function") {
    return materialize(mod.createAgent, true);
  }
  if (mod.default) {
    return materialize(mod.default);
  }
  for (const value of Object.values(mod)) {
    const candidate = materialize(value);
    if (candidate?.id === item?.id) return candidate;
  }
  return null;
}

function materialize(value, callDirect = false) {
  if (!value) return null;
  if (typeof value === "object" && value.id && typeof value.execute === "function") return value;
  if (typeof value !== "function") return null;
  if (callDirect) {
    const out = value();
    if (out && out.id && typeof out.execute === "function") return out;
  }
  try {
    const out = new value();
    if (out && out.id && typeof out.execute === "function") return out;
  } catch {
    // ignore class/constructor mismatch
  }
  try {
    const out = value();
    if (out && out.id && typeof out.execute === "function") return out;
  } catch {
    return null;
  }
  return null;
}
