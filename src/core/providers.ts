const OLLAMA_DEFAULT_ENDPOINT = "http://localhost:11434";

interface ProviderConfig {
  env: string[];
  modelEnv: string;
  defaultModel: string;
}

export const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  "azure-openai": {
    env: ["AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT"],
    modelEnv: "AZURE_OPENAI_MODEL",
    defaultModel: "gpt-4o-mini"
  },
  openai: {
    env: ["OPENAI_API_KEY", "OPENAI_ENDPOINT"],
    modelEnv: "OPENAI_MODEL",
    defaultModel: "gpt-4o-mini"
  },
  anthropic: {
    env: ["ANTHROPIC_API_KEY"],
    modelEnv: "ANTHROPIC_MODEL",
    defaultModel: "claude-3-5-sonnet-latest"
  },
  ollama: {
    env: ["OLLAMA_ENDPOINT"],
    modelEnv: "OLLAMA_MODEL",
    defaultModel: "phi3"
  }
};

export function listProviders(): string[] {
  return Object.keys(PROVIDER_CONFIGS);
}

export function isKnownProvider(name: string): boolean {
  return PROVIDER_CONFIGS[name] !== undefined;
}

export function checkProviderEnv(name: string, env: NodeJS.ProcessEnv = process.env): { ok: boolean; missing: string[] } {
  const cfg = PROVIDER_CONFIGS[name];
  if (!cfg) return { ok: false, missing: ["unknown provider"] };

  const missing = cfg.env.filter((key) => {
    if (name === "ollama" && key === "OLLAMA_ENDPOINT") return false;
    return !env[key];
  });

  return {
    ok: missing.length === 0,
    missing
  };
}

export function getProviderModel(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const cfg = PROVIDER_CONFIGS[name];
  if (!cfg) return undefined;
  return env[cfg.modelEnv] ?? cfg.defaultModel;
}

export function setProviderModel(name: string, model: string, env: NodeJS.ProcessEnv = process.env): void {
  const cfg = PROVIDER_CONFIGS[name];
  if (!cfg) throw new Error(`Unknown provider: ${name}`);
  env[cfg.modelEnv] = model;
}

function normalizeOllamaModelName(name: string): string {
  if (name.endsWith(":latest")) return name.slice(0, -7);
  return name;
}

export async function listOllamaModels(
  env: NodeJS.ProcessEnv = process.env,
  fetchFn: typeof fetch = fetch
): Promise<string[]> {
  const endpoint = env.OLLAMA_ENDPOINT || OLLAMA_DEFAULT_ENDPOINT;
  const res = await fetchFn(`${endpoint}/api/tags`);
  if (!res.ok) {
    throw new Error(`Ollama tag request failed with status ${res.status}`);
  }

  const data = (await res.json()) as { models?: Array<{ name?: string }> };
  const models = Array.isArray(data.models)
    ? data.models.map((m) => normalizeOllamaModelName(String(m.name ?? ""))).filter(Boolean)
    : [];

  return [...new Set(models)];
}

export async function getAvailableModels(
  provider: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchFn: typeof fetch = fetch
): Promise<string[]> {
  if (!isKnownProvider(provider)) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  if (provider === "ollama") {
    const models = await listOllamaModels(env, fetchFn);
    const current = getProviderModel(provider, env);
    if (current && !models.includes(current)) {
      return [current, ...models];
    }
    return models;
  }

  const current = getProviderModel(provider, env);
  return current ? [current] : [];
}
