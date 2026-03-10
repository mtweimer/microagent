import { DeviceCodeAuth } from "./deviceCodeAuth.js";

export class GraphClient {
  constructor({ clientId, tenantId, scopes, cachePath, baseDir, fetchFn = fetch }) {
    this.fetchFn = fetchFn;
    this.auth = new DeviceCodeAuth({
      clientId,
      tenantId,
      scopes,
      cachePath,
      baseDir,
      fetchFn
    });
  }

  async login(onPrompt) {
    return this.auth.loginWithDeviceCode(onPrompt);
  }

  async getMe() {
    return this.get("/me");
  }

  async get(path) {
    return this.request("GET", path);
  }

  async post(path, body) {
    return this.request("POST", path, body);
  }

  async patch(path, body) {
    return this.request("PATCH", path, body);
  }

  async request(method, path, body) {
    const token = await this.auth.getAccessToken();
    const url = path.startsWith("http") ? path : `https://graph.microsoft.com/v1.0${path}`;
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    };

    const res = await this.fetchFn(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    const text = await res.text();
    const payload = text ? safeJson(text) : {};

    if (!res.ok) {
      throw new Error(`Graph ${method} ${path} failed: ${res.status} ${JSON.stringify(payload)}`);
    }

    return payload;
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
