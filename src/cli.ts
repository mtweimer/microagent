#!/usr/bin/env node
import { runInteractive, buildRuntime } from "./cli/runtime.js";
import { listProfiles, loadProfile, validateProfile } from "./core/profile.js";
import { runBenchmarks } from "./bench/index.js";
import { runSystemCheck } from "./core/check.js";
import { parsePluginPathArg, validatePlugins } from "./core/pluginValidator.js";
import type { AnyRecord } from "./core/contracts.js";

const PROVIDERS = ["ollama", "openai", "azure-openai", "anthropic"] as const;
type ProviderName = (typeof PROVIDERS)[number];

function asRecord(value: unknown): AnyRecord {
  return typeof value === "object" && value !== null ? (value as AnyRecord) : {};
}

function parseArg(flag: string, args: string[]): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] ?? "run";

  if (cmd === "run") {
    const profile = parseArg("--profile", args) ?? "default";
    await runInteractive(profile);
    return;
  }

  if (cmd === "doctor") {
    const profileName = parseArg("--profile", args) ?? "default";
    const runtime = await buildRuntime(profileName);
    const health = [];
    for (const p of PROVIDERS) health.push(await runtime.modelGateway.healthCheck(p));

    const profileCheck = validateProfile(runtime.profile);

    let graph:
      | { enabled: false; reason: string | null; tokenCached: boolean }
      | { enabled: true; tenantId: string; scopes: string[]; tokenCached: boolean; expiresAt: number | null } = {
      enabled: false,
      reason: runtime.graphState.enabled ? null : runtime.graphState.reason ?? null,
      tokenCached: false
    };

    if (runtime.graphState.enabled && runtime.graphState.client) {
      const token = runtime.graphState.client.auth.loadCache();
      graph = {
        enabled: true,
        tenantId: runtime.graphState.client.auth.tenantId,
        scopes: runtime.graphState.client.auth.scopes,
        tokenCached: !!token,
        expiresAt: token?.expires_at ?? null
      };
    }

    const composer = asRecord(runtime.dispatcher?.composerConfig);
    const primary = composer.primary ?? null;
    const fallback = composer.fallback ?? null;
    let primaryReady = false;
    let fallbackReady = false;
    const primaryRecord = asRecord(primary);
    const fallbackRecord = asRecord(fallback);
    if (typeof primaryRecord.provider === "string") {
      primaryReady = runtime.modelGateway.checkAuth(primaryRecord.provider as ProviderName).ok;
    }
    if (typeof fallbackRecord.provider === "string") {
      fallbackReady = runtime.modelGateway.checkAuth(fallbackRecord.provider as ProviderName).ok;
    }

    console.log(JSON.stringify({
      command: "doctor",
      profile: profileName,
      profilePath: runtime.profilePath,
      profileValid: profileCheck,
      providers: health,
      graph,
      memory:
        typeof (runtime.memory as { stats?: () => unknown }).stats === "function"
          ? (runtime.memory as { stats: () => unknown }).stats()
          : { backend: "inmemory" },
      cache: {
        enabled: runtime.profile.cache?.enabled !== false,
        grammarSystem: runtime.profile.cache?.grammarSystem ?? "completionBased",
        patternCache: runtime.patternCache?.stats?.() ?? null,
        grammarStore: runtime.grammarStore?.stats?.() ?? null
      },
      composer: {
        enabled: composer.enabled !== false,
        strategy: composer.strategy ?? "hybrid_fallback",
        primary,
        fallback,
        primaryReady,
        fallbackReady,
        budget: composer.budget ?? {},
        quality: composer.quality ?? {}
      },
      agents: runtime.agentCatalog
    }, null, 2));
    return;
  }

  if (cmd === "check") {
    const profileName = parseArg("--profile", args) ?? "default";
    const result = await runSystemCheck(profileName);
    console.log(JSON.stringify({ command: "check", ...result }, null, 2));
    if (!result.profileValidation.ok || !result.schemaCheck.ok || !result.traceValidation.ok) {
      process.exit(1);
    }
    return;
  }

  if (cmd === "profile") {
    const sub = args[1] ?? "list";
    if (sub === "list") {
      console.log(JSON.stringify({ profiles: listProfiles() }, null, 2));
      return;
    }

    if (sub === "show") {
      const name = parseArg("--profile", args) ?? "default";
      const { profile, filePath } = loadProfile(name);
      console.log(JSON.stringify({ profile, filePath }, null, 2));
      return;
    }

    if (sub === "validate") {
      const name = parseArg("--profile", args) ?? "default";
      const { profile, filePath } = loadProfile(name);
      console.log(JSON.stringify({ filePath, validation: validateProfile(profile) }, null, 2));
      return;
    }

    throw new Error(`Unknown profile subcommand '${sub}'`);
  }

  if (cmd === "bench") {
    const suite = parseArg("--suite", args) ?? "all";
    const results = await runBenchmarks(suite);
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  if (cmd === "plugins") {
    const sub = args[1] ?? "validate";
    if (sub !== "validate") {
      throw new Error(`Unknown plugins subcommand '${sub}'. Use plugins validate`);
    }
    const profileName = parseArg("--profile", args) ?? "default";
    const extraPaths = parsePluginPathArg(parseArg("--paths", args));
    const { profile } = loadProfile(profileName);
    const result = await validatePlugins({
      profile,
      env: process.env,
      agentPaths: extraPaths
    });
    console.log(JSON.stringify({ command: "plugins validate", profile: profileName, ...result }, null, 2));
    if (!result.ok) process.exit(1);
    return;
  }

  throw new Error(`Unknown command '${cmd}'. Use run|doctor|check|profile|bench|plugins`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
