import fs from "node:fs";
import path from "node:path";

export interface TokenCacheRecord {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  token_type?: string;
  scope?: string;
}

export interface DeviceCodePayload {
  message?: string;
  verification_uri?: string;
  user_code?: string;
  interval?: number;
  expires_in?: number;
  device_code: string;
}

interface OAuthTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number | string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

type FetchLike = typeof fetch;

type DeviceCodeAuthOptions = {
  clientId: string;
  tenantId?: string;
  scopes?: string[];
  cachePath?: string;
  baseDir?: string;
  fetchFn?: FetchLike;
};

function nowEpochSec(): number {
  return Math.floor(Date.now() / 1000);
}

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export class DeviceCodeAuth {
  clientId: string;
  tenantId: string;
  scopes: string[];
  cachePath: string;
  fetchFn: FetchLike;
  base: string;

  constructor({
    clientId,
    tenantId = "common",
    scopes = [],
    cachePath = "./data/graph-token.json",
    baseDir = process.cwd(),
    fetchFn = fetch
  }: DeviceCodeAuthOptions) {
    if (!clientId) throw new Error("MSGRAPH_APP_CLIENTID is required for device code auth");
    this.clientId = clientId;
    this.tenantId = tenantId || "common";
    this.scopes = scopes;
    this.cachePath = path.resolve(baseDir, cachePath);
    this.fetchFn = fetchFn;
    this.base = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0`;
  }

  loadCache(): TokenCacheRecord | undefined {
    if (!fs.existsSync(this.cachePath)) return undefined;
    return JSON.parse(fs.readFileSync(this.cachePath, "utf8")) as TokenCacheRecord;
  }

  saveCache(token: TokenCacheRecord): void {
    ensureDir(this.cachePath);
    fs.writeFileSync(this.cachePath, JSON.stringify(token, null, 2));
  }

  isUsable(token: TokenCacheRecord | undefined): boolean {
    if (!token?.access_token || !token?.expires_at) return false;
    if (token.expires_at <= nowEpochSec() + 60) return false;
    return this.getMissingScopes(token).length === 0;
  }

  async getAccessToken(): Promise<string> {
    const cached = this.loadCache();
    if (cached && this.isUsable(cached)) {
      return cached.access_token;
    }

    if (cached?.refresh_token) {
      const refreshed = await this.refreshToken(cached.refresh_token);
      if (refreshed?.access_token && this.isUsable(refreshed)) {
        this.saveCache(refreshed);
        return refreshed.access_token;
      }
    }

    const missing = cached ? this.getMissingScopes(cached) : [];
    if (cached && missing.length > 0) {
      throw new Error(
        `Graph token missing required scopes: ${missing.join(", ")}. ` +
          "Run '/graph logout' then '/graph login' after granting consent."
      );
    }
    throw new Error("Graph not authenticated. Run '/graph login' in the CLI.");
  }

  async refreshToken(refreshToken: string): Promise<TokenCacheRecord | undefined> {
    const body = new URLSearchParams({
      client_id: this.clientId,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: this.scopes.join(" ")
    });

    const res = await this.fetchFn(`${this.base}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });

    if (!res.ok) return undefined;
    const data = (await res.json()) as OAuthTokenResponse;
    return normalizeTokenResponse(data);
  }

  async loginWithDeviceCode(onPrompt?: (message: string) => void): Promise<TokenCacheRecord> {
    const scope = this.scopes.join(" ");
    const codeBody = new URLSearchParams({
      client_id: this.clientId,
      scope
    });

    const codeRes = await this.fetchWithContext(
      `${this.base}/devicecode`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: codeBody.toString()
      },
      "device_code_init"
    );

    if (!codeRes.ok) {
      const e = await codeRes.text();
      throw new Error(`Device code init failed: ${e}`);
    }

    const deviceCode = (await codeRes.json()) as DeviceCodePayload;
    onPrompt?.(deviceCode.message ?? `Visit ${deviceCode.verification_uri} and enter ${deviceCode.user_code}`);

    const intervalSec = Math.max(2, Number(deviceCode.interval ?? 5));
    const expiresAt = Date.now() + Number(deviceCode.expires_in ?? 900) * 1000;

    while (Date.now() < expiresAt) {
      await sleep(intervalSec * 1000);

      const tokenBody = new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: this.clientId,
        device_code: deviceCode.device_code
      });

      const tokenRes = await this.fetchWithContext(
        `${this.base}/token`,
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: tokenBody.toString()
        },
        "device_code_poll"
      );

      const tokenJson = (await tokenRes.json()) as OAuthTokenResponse;
      if (tokenRes.ok && tokenJson.access_token) {
        const token = normalizeTokenResponse(tokenJson);
        const missing = this.getMissingScopes(token);
        if (missing.length > 0) {
          throw new Error(
            `Authenticated token is missing required scopes: ${missing.join(", ")}. ` +
              "Grant consent for these scopes and retry login."
          );
        }
        this.saveCache(token);
        return token;
      }

      const err = tokenJson.error;
      if (err === "authorization_pending") continue;
      if (err === "slow_down") {
        await sleep(2000);
        continue;
      }
      if (err === "expired_token") {
        throw new Error("Device code expired. Start login again.");
      }

      throw new Error(tokenJson.error_description || `Device code auth failed: ${err}`);
    }

    throw new Error("Device code login timed out.");
  }

  clear(): void {
    if (fs.existsSync(this.cachePath)) fs.unlinkSync(this.cachePath);
  }

  getMissingScopes(token: Pick<TokenCacheRecord, "scope"> | undefined): string[] {
    const required = normalizeScopeList(this.scopes).filter(isEnforcedGraphScope);
    if (required.length === 0) return [];
    const granted = new Set(normalizeScopeList(token?.scope));
    return required.filter((scope) => !granted.has(scope));
  }

  async fetchWithContext(url: string, init: RequestInit, phase: string): Promise<Response> {
    try {
      return await this.fetchFn(url, init);
    } catch (error) {
      const reason = String(error instanceof Error ? error.message : error ?? "unknown error");
      throw new Error(`Graph auth network error during ${phase} (${url}): ${reason}`);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeTokenResponse(data: OAuthTokenResponse): TokenCacheRecord {
  const token: TokenCacheRecord = {
    access_token: String(data.access_token ?? ""),
    expires_at: nowEpochSec() + Number(data.expires_in ?? 3600)
  };
  if (typeof data.refresh_token === "string") token.refresh_token = data.refresh_token;
  if (typeof data.token_type === "string") token.token_type = data.token_type;
  if (typeof data.scope === "string") token.scope = data.scope;
  return token;
}

function normalizeScopeList(scopes: string[] | string | undefined): string[] {
  const raw =
    Array.isArray(scopes) ? scopes.map((s) => String(s)).join(" ") : String(scopes ?? "");
  return raw
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const lower = s.toLowerCase();
      const idx = lower.lastIndexOf("/");
      return idx >= 0 ? lower.slice(idx + 1) : lower;
    });
}

function isEnforcedGraphScope(scope: string): boolean {
  const s = String(scope ?? "").toLowerCase();
  return s !== "offline_access" && s !== "openid" && s !== "profile" && s !== "email";
}
