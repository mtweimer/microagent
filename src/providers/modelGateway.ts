// @ts-nocheck
import {
  checkProviderEnv,
  getAvailableModels,
  getProviderModel,
  isKnownProvider,
  setProviderModel
} from "../core/providers.js";

const DEFAULT_TIMEOUT_MS = 30000;

async function fetchJson(url, init = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

export class ModelGateway {
  constructor(env = process.env) {
    this.env = env;
  }

  getActiveProvider() {
    const provider = this.env.MICRO_CLAW_PROVIDER ?? "ollama";
    return isKnownProvider(provider) ? provider : "ollama";
  }

  setActiveProvider(provider) {
    if (!isKnownProvider(provider)) throw new Error(`Unknown provider: ${provider}`);
    this.env.MICRO_CLAW_PROVIDER = provider;
  }

  getActiveModel(provider = this.getActiveProvider()) {
    return getProviderModel(provider, this.env);
  }

  setActiveModel(model, provider = this.getActiveProvider()) {
    setProviderModel(provider, model, this.env);
  }

  async listModels(provider = this.getActiveProvider()) {
    return getAvailableModels(provider, this.env);
  }

  checkAuth(provider = this.getActiveProvider()) {
    return checkProviderEnv(provider, this.env);
  }

  async healthCheck(provider = this.getActiveProvider()) {
    const auth = this.checkAuth(provider);

    if (provider === "ollama") {
      const endpoint = this.env.OLLAMA_ENDPOINT || "http://localhost:11434";
      try {
        const r = await fetchJson(`${endpoint}/api/tags`, { method: "GET" }, 5000);
        return {
          provider,
          auth,
          reachable: r.ok,
          status: r.status,
          model: this.getActiveModel(provider)
        };
      } catch (error) {
        return { provider, auth, reachable: false, error: String(error.message ?? error) };
      }
    }

    return {
      provider,
      auth,
      reachable: auth.ok,
      model: this.getActiveModel(provider)
    };
  }

  async completeText(messages, options = {}) {
    const provider = options.provider ?? this.getActiveProvider();
    const model = options.model ?? this.getActiveModel(provider);

    if (provider === "ollama") {
      return this.completeOllama(messages, model);
    }
    if (provider === "openai") {
      return this.completeOpenAI(messages, model);
    }
    if (provider === "azure-openai") {
      return this.completeAzure(messages, model);
    }
    if (provider === "anthropic") {
      return this.completeAnthropic(messages, model);
    }

    throw new Error(`Unsupported provider: ${provider}`);
  }

  async completeJson(messages, options = {}) {
    const text = await this.completeText(messages, options);
    const parsed = tryParseJson(text);
    if (parsed.ok) return parsed.value;
    throw new Error("Model did not return valid JSON");
  }

  async completeOllama(messages, model) {
    const endpoint = this.env.OLLAMA_ENDPOINT || "http://localhost:11434";
    const r = await fetchJson(`${endpoint}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, messages, stream: false })
    });

    if (!r.ok) throw new Error(`Ollama error: ${r.status}`);
    return r.data?.message?.content ?? "";
  }

  async completeOpenAI(messages, model) {
    const endpoint = this.env.OPENAI_ENDPOINT || "https://api.openai.com/v1/chat/completions";
    const key = this.env.OPENAI_API_KEY;

    const r = await fetchJson(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`
      },
      body: JSON.stringify({ model, messages })
    });

    if (!r.ok) throw new Error(`OpenAI error: ${r.status}`);
    return r.data?.choices?.[0]?.message?.content ?? "";
  }

  async completeAzure(messages, _model) {
    const endpoint = this.env.AZURE_OPENAI_ENDPOINT;
    const key = this.env.AZURE_OPENAI_API_KEY;

    const r = await fetchJson(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "api-key": key
      },
      body: JSON.stringify({ messages })
    });

    if (!r.ok) throw new Error(`Azure OpenAI error: ${r.status}`);
    return r.data?.choices?.[0]?.message?.content ?? "";
  }

  async completeAnthropic(messages, model) {
    const key = this.env.ANTHROPIC_API_KEY;
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    const userParts = messages.filter((m) => m.role !== "system").map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content
    }));

    const r = await fetchJson("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system,
        messages: userParts
      })
    });

    if (!r.ok) throw new Error(`Anthropic error: ${r.status}`);

    const content = r.data?.content;
    if (Array.isArray(content) && content[0]?.type === "text") {
      return content[0].text;
    }

    return "";
  }
}

function tryParseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (match) {
      try {
        return { ok: true, value: JSON.parse(match[1]) };
      } catch {
        return { ok: false };
      }
    }
    return { ok: false };
  }
}
