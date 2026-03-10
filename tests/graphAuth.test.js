import test from "node:test";
import assert from "node:assert/strict";

import { DeviceCodeAuth } from "../src/graph/deviceCodeAuth.js";

test("device auth uses cached valid token", async () => {
  const auth = new DeviceCodeAuth({
    clientId: "client",
    tenantId: "common",
    scopes: ["User.Read"],
    cachePath: "./data/test-graph-token.json",
    fetchFn: async () => {
      throw new Error("should not call network");
    }
  });

  auth.saveCache({
    access_token: "abc",
    refresh_token: "r1",
    expires_at: Math.floor(Date.now() / 1000) + 600,
    scope: "User.Read"
  });

  const token = await auth.getAccessToken();
  assert.equal(token, "abc");

  auth.clear();
});

test("device auth rejects cached token missing required scope", async () => {
  const auth = new DeviceCodeAuth({
    clientId: "client",
    tenantId: "common",
    scopes: ["User.Read", "Chat.Read"],
    cachePath: "./data/test-graph-token-missing-scope.json",
    fetchFn: async () => {
      throw new Error("network should not be called without refresh token");
    }
  });

  auth.saveCache({
    access_token: "abc",
    expires_at: Math.floor(Date.now() / 1000) + 600,
    scope: "User.Read"
  });

  await assert.rejects(
    async () => auth.getAccessToken(),
    /missing required scopes/i
  );

  auth.clear();
});

test("device auth with no cache returns not authenticated", async () => {
  const auth = new DeviceCodeAuth({
    clientId: "client",
    tenantId: "common",
    scopes: ["User.Read"],
    cachePath: "./data/test-graph-token-none.json",
    fetchFn: async () => {
      throw new Error("network should not be called");
    }
  });

  auth.clear();
  await assert.rejects(
    async () => auth.getAccessToken(),
    /Graph not authenticated/i
  );
});

test("device auth does not enforce oidc helper scopes in token scope string", async () => {
  const auth = new DeviceCodeAuth({
    clientId: "client",
    tenantId: "common",
    scopes: ["User.Read", "offline_access", "openid", "profile", "email"],
    cachePath: "./data/test-graph-token-oidc-scopes.json",
    fetchFn: async () => {
      throw new Error("should not call network");
    }
  });

  auth.saveCache({
    access_token: "abc",
    expires_at: Math.floor(Date.now() / 1000) + 600,
    scope: "User.Read"
  });

  const token = await auth.getAccessToken();
  assert.equal(token, "abc");
  auth.clear();
});
