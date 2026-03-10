import fs from "node:fs";
import path from "node:path";

export interface MicroClawProfile {
  name?: string;
  provider?: {
    active?: string;
    models?: Record<string, string>;
  };
  agents?: {
    enabled?: string[];
    paths?: string[];
  };
  graph?: {
    auth?: {
      mode?: string;
    };
    scopes?: string[];
  };
  memory?: {
    backend?: string;
    dbPath?: string;
  };
  cache?: {
    enabled?: boolean;
    grammarSystem?: "completionBased" | "nfa" | string;
  };
  safety?: {
    localToolsPolicy?: string;
    suggestionPolicy?: {
      maxAutoApplyRisk?: string;
    };
  };
  conversation?: {
    composer?: {
      enabled?: boolean;
      primary?: Record<string, unknown>;
      fallback?: Record<string, unknown>;
    };
  };
  [key: string]: unknown;
}

export interface ProfileValidationResult {
  ok: boolean;
  errors: string[];
}

const PROFILE_DIR = path.resolve(process.cwd(), "profiles");

export function listProfiles(): string[] {
  if (!fs.existsSync(PROFILE_DIR)) return [];
  return fs
    .readdirSync(PROFILE_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5))
    .sort();
}

export function loadProfile(name = "default"): { profile: MicroClawProfile; filePath: string } {
  const filePath = path.join(PROFILE_DIR, `${name}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Profile '${name}' not found at ${filePath}`);
  }
  const profile = JSON.parse(fs.readFileSync(filePath, "utf8")) as MicroClawProfile;
  return { profile, filePath };
}

export function validateProfile(profile: unknown): ProfileValidationResult {
  const errors: string[] = [];

  if (!profile || typeof profile !== "object") {
    return { ok: false, errors: ["Profile must be an object"] };
  }

  const typed = profile as MicroClawProfile;

  if (!typed.name) errors.push("Missing profile.name");
  if (!typed.provider?.active) errors.push("Missing provider.active");
  if (!typed.provider?.models || typeof typed.provider.models !== "object") {
    errors.push("Missing provider.models");
  }
  if (!Array.isArray(typed.agents?.enabled)) errors.push("Missing agents.enabled[]");
  if (
    typeof typed.agents?.paths !== "undefined" &&
    (!Array.isArray(typed.agents.paths) || typed.agents.paths.some((p) => typeof p !== "string"))
  ) {
    errors.push("agents.paths must be string[]");
  }
  if (!typed.graph?.auth?.mode) errors.push("Missing graph.auth.mode");
  if (!Array.isArray(typed.graph?.scopes)) errors.push("Missing graph.scopes[]");
  if (!typed.memory?.backend) errors.push("Missing memory.backend");
  if (!typed.memory?.dbPath) errors.push("Missing memory.dbPath");
  if (typeof typed.cache?.enabled !== "boolean") errors.push("Missing cache.enabled");
  if (typed.cache?.grammarSystem && !["completionBased", "nfa"].includes(typed.cache.grammarSystem)) {
    errors.push("cache.grammarSystem must be completionBased or nfa");
  }
  if (!typed.safety?.localToolsPolicy) errors.push("Missing safety.localToolsPolicy");
  if (
    typed.safety?.suggestionPolicy &&
    typeof typed.safety.suggestionPolicy.maxAutoApplyRisk !== "string"
  ) {
    errors.push("safety.suggestionPolicy.maxAutoApplyRisk must be string");
  }

  if (typed.conversation?.composer) {
    const composer = typed.conversation.composer;
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

export function resolveProfileModel(profile: MicroClawProfile, provider: string): string | undefined {
  return profile.provider?.models?.[provider];
}

export function applyProfileToEnv(profile: MicroClawProfile, env: NodeJS.ProcessEnv = process.env): void {
  if (profile.provider?.active) env.MICRO_CLAW_PROVIDER = profile.provider.active;

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
