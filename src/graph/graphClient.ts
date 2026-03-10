import { DeviceCodeAuth } from "./deviceCodeAuth.js";
import type { TokenCacheRecord } from "./deviceCodeAuth.js";

type FetchLike = typeof fetch;

export type GraphJson = Record<string, unknown>;

export interface GraphClientOptions {
  clientId: string;
  tenantId?: string;
  scopes: string[];
  cachePath: string;
  baseDir: string;
  fetchFn?: FetchLike;
}

function safeJson(text: string): GraphJson {
  try {
    return JSON.parse(text) as GraphJson;
  } catch {
    return { raw: text };
  }
}

export class GraphClient {
  fetchFn: FetchLike;
  auth: DeviceCodeAuth;

  constructor({ clientId, tenantId, scopes, cachePath, baseDir, fetchFn = fetch }: GraphClientOptions) {
    this.fetchFn = fetchFn;
    const authOptions = {
      clientId,
      scopes,
      cachePath,
      baseDir,
      fetchFn,
      ...(tenantId ? { tenantId } : {})
    };
    this.auth = new DeviceCodeAuth(authOptions);
  }

  async login(onPrompt?: (message: string) => void): Promise<TokenCacheRecord> {
    return this.auth.loginWithDeviceCode(onPrompt);
  }

  async getMe(): Promise<GraphJson> {
    return this.get("/me");
  }

  async get(path: string): Promise<GraphJson> {
    return this.request("GET", path);
  }

  async post(path: string, body: unknown): Promise<GraphJson> {
    return this.request("POST", path, body);
  }

  async patch(path: string, body: unknown): Promise<GraphJson> {
    return this.request("PATCH", path, body);
  }

  async request(method: string, path: string, body?: unknown): Promise<GraphJson> {
    const token = await this.auth.getAccessToken();
    const url = path.startsWith("http") ? path : `https://graph.microsoft.com/v1.0${path}`;
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    };

    const init: RequestInit = {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {})
    };

    const res = await this.fetchFn(url, init);

    const text = await res.text();
    const payload = text ? safeJson(text) : {};

    if (!res.ok) {
      throw new Error(`Graph ${method} ${path} failed: ${res.status} ${JSON.stringify(payload)}`);
    }

    return payload;
  }
}
