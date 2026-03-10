const OLLAMA_DEFAULT_ENDPOINT = "http://localhost:11434";

export const PROVIDER_CONFIGS = {
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

export function listProviders() {
  return Object.keys(PROVIDER_CONFIGS);
}

export function isKnownProvider(name) {
  return PROVIDER_CONFIGS[name] !== undefined;
}

export function checkProviderEnv(name, env = process.env) {
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

export function getProviderModel(name, env = process.env) {
  const cfg = PROVIDER_CONFIGS[name];
  if (!cfg) return undefined;
  return env[cfg.modelEnv] ?? cfg.defaultModel;
}

export function setProviderModel(name, model, env = process.env) {
  const cfg = PROVIDER_CONFIGS[name];
  if (!cfg) throw new Error(`Unknown provider: ${name}`);
  env[cfg.modelEnv] = model;
}

function normalizeOllamaModelName(name) {
  if (name.endsWith(":latest")) return name.slice(0, -7);
  return name;
}

export async function listOllamaModels(env = process.env, fetchFn = fetch) {
  const endpoint = env.OLLAMA_ENDPOINT || OLLAMA_DEFAULT_ENDPOINT;
  const res = await fetchFn(`${endpoint}/api/tags`);
  if (!res.ok) {
    throw new Error(`Ollama tag request failed with status ${res.status}`);
  }

  const data = await res.json();
  const models = Array.isArray(data.models)
    ? data.models.map((m) => normalizeOllamaModelName(m.name)).filter(Boolean)
    : [];

  return [...new Set(models)];
}

export async function getAvailableModels(provider, env = process.env, fetchFn = fetch) {
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
