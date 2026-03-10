// @ts-nocheck
import fs from "node:fs";
import path from "node:path";

const PROFILE_DIR = path.resolve(process.cwd(), "profiles");

export function listProfiles() {
  if (!fs.existsSync(PROFILE_DIR)) return [];
  return fs
    .readdirSync(PROFILE_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5))
    .sort();
}

export function loadProfile(name = "default") {
  const filePath = path.join(PROFILE_DIR, `${name}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Profile '${name}' not found at ${filePath}`);
  }
  const profile = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return { profile, filePath };
}

export function validateProfile(profile) {
  const errors = [];

  if (!profile || typeof profile !== "object") {
    return { ok: false, errors: ["Profile must be an object"] };
  }

  if (!profile.name) errors.push("Missing profile.name");
  if (!profile.provider?.active) errors.push("Missing provider.active");
  if (!profile.provider?.models || typeof profile.provider.models !== "object") {
    errors.push("Missing provider.models");
  }
  if (!Array.isArray(profile.agents?.enabled)) errors.push("Missing agents.enabled[]");
  if (
    typeof profile.agents?.paths !== "undefined" &&
    (!Array.isArray(profile.agents.paths) || profile.agents.paths.some((p) => typeof p !== "string"))
  ) {
    errors.push("agents.paths must be string[]");
  }
  if (!profile.graph?.auth?.mode) errors.push("Missing graph.auth.mode");
  if (!Array.isArray(profile.graph?.scopes)) errors.push("Missing graph.scopes[]");
  if (!profile.memory?.backend) errors.push("Missing memory.backend");
  if (!profile.memory?.dbPath) errors.push("Missing memory.dbPath");
  if (typeof profile.cache?.enabled !== "boolean") errors.push("Missing cache.enabled");
  if (profile.cache?.grammarSystem && !["completionBased", "nfa"].includes(profile.cache.grammarSystem)) {
    errors.push("cache.grammarSystem must be completionBased or nfa");
  }
  if (!profile.safety?.localToolsPolicy) errors.push("Missing safety.localToolsPolicy");
  if (
    profile.safety?.suggestionPolicy &&
    typeof profile.safety.suggestionPolicy.maxAutoApplyRisk !== "string"
  ) {
    errors.push("safety.suggestionPolicy.maxAutoApplyRisk must be string");
  }

  if (profile.conversation?.composer) {
    const composer = profile.conversation.composer;
    if (typeof composer.enabled !== "undefined" && typeof composer.enabled !== "boolean") {
      errors.push("conversation.composer.enabled must be boolean");
    }
    if (composer.primary && typeof composer.primary !== "object") {
      errors.push("conversation.composer.primary must be object");
    }
    if (composer.fallback && typeof composer.fallback !== "object") {
      errors.push("conversation.composer.fallback must be object");
    }
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

export function resolveProfileModel(profile, provider) {
  return profile.provider?.models?.[provider];
}

export function applyProfileToEnv(profile, env = process.env) {
  env.MICRO_CLAW_PROVIDER = profile.provider.active;

  if (profile.provider?.models?.openai) {
    env.OPENAI_MODEL = profile.provider.models.openai;
  }
  if (profile.provider?.models?.["azure-openai"]) {
    env.AZURE_OPENAI_MODEL = profile.provider.models["azure-openai"];
  }
  if (profile.provider?.models?.anthropic) {
    env.ANTHROPIC_MODEL = profile.provider.models.anthropic;
  }
  if (profile.provider?.models?.ollama) {
    env.OLLAMA_MODEL = profile.provider.models.ollama;
  }
}
