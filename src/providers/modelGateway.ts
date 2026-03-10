import {
  checkProviderEnv,
  getAvailableModels,
  getProviderModel,
  isKnownProvider,
  setProviderModel
} from "../core/providers.js";

const DEFAULT_TIMEOUT_MS = 30000;

interface FetchJsonResult {
  ok: boolean;
  status: number;
  data: Record<string, unknown>;
}

interface ModelMessage {
  role: string;
  content: string;
}

type ProviderName = "ollama" | "openai" | "azure-openai" | "anthropic";

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<FetchJsonResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      data = { raw: text };
    }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

export class ModelGateway {
  env: NodeJS.ProcessEnv;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.env = env;
  }

  getActiveProvider(): ProviderName {
    const provider = this.env.MICRO_CLAW_PROVIDER ?? "ollama";
    return isKnownProvider(provider) ? (provider as ProviderName) : "ollama";
  }

  setActiveProvider(provider: string): void {
    if (!isKnownProvider(provider)) throw new Error(`Unknown provider: ${provider}`);
    this.env.MICRO_CLAW_PROVIDER = provider;
  }

  getActiveModel(provider: ProviderName = this.getActiveProvider()): string {
    return getProviderModel(provider, this.env) ?? "";
  }

  setActiveModel(model: string, provider: ProviderName = this.getActiveProvider()): void {
    setProviderModel(provider, model, this.env);
  }

  async listModels(provider: ProviderName = this.getActiveProvider()): Promise<string[]> {
    return getAvailableModels(provider, this.env);
  }

  checkAuth(provider: ProviderName = this.getActiveProvider()) {
    return checkProviderEnv(provider, this.env);
  }

  async healthCheck(provider: ProviderName = this.getActiveProvider()): Promise<Record<string, unknown>> {
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
        return { provider, auth, reachable: false, error: String(error instanceof Error ? error.message : error) };
      }
    }

    return {
      provider,
      auth,
      reachable: auth.ok,
      model: this.getActiveModel(provider)
    };
  }

  async completeText(messages: ModelMessage[], options: Record<string, unknown> = {}): Promise<string> {
    const provider = (options.provider as ProviderName | undefined) ?? this.getActiveProvider();
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

  async completeJson(messages: ModelMessage[], options: Record<string, unknown> = {}): Promise<unknown> {
    const text = await this.completeText(messages, options);
    const parsed = tryParseJson(text);
    if (parsed.ok) return parsed.value;
    throw new Error("Model did not return valid JSON");
  }

  async completeOllama(messages: ModelMessage[], model: unknown): Promise<string> {
    const endpoint = this.env.OLLAMA_ENDPOINT || "http://localhost:11434";
    const r = await fetchJson(`${endpoint}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, messages, stream: false })
    });

    if (!r.ok) throw new Error(`Ollama error: ${r.status}`);
    return String(asRecord(asRecord(r.data).message).content ?? "");
  }

  async completeOpenAI(messages: ModelMessage[], model: unknown): Promise<string> {
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
    const choices = asRecord(r.data).choices;
    const first = Array.isArray(choices) ? asRecord(choices[0]) : {};
    return String(asRecord(first.message).content ?? "");
  }

  async completeAzure(messages: ModelMessage[], _model: unknown): Promise<string> {
    const endpoint = this.env.AZURE_OPENAI_ENDPOINT;
    const key = this.env.AZURE_OPENAI_API_KEY;
    if (!endpoint) throw new Error("Azure OpenAI endpoint is not configured");

    const r = await fetchJson(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "api-key": key
      },
      body: JSON.stringify({ messages })
    });

    if (!r.ok) throw new Error(`Azure OpenAI error: ${r.status}`);
    const choices = asRecord(r.data).choices;
    const first = Array.isArray(choices) ? asRecord(choices[0]) : {};
    return String(asRecord(first.message).content ?? "");
  }

  async completeAnthropic(messages: ModelMessage[], model: unknown): Promise<string> {
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

    const content = asRecord(r.data).content;
    if (Array.isArray(content) && asRecord(content[0]).type === "text") {
      return String(asRecord(content[0]).text ?? "");
    }

    return "";
  }
}

function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (match) {
      try {
        return { ok: true, value: JSON.parse(match[1] ?? "") };
      } catch {
        return { ok: false };
      }
    }
    return { ok: false };
  }
}
