import test from "node:test";
import assert from "node:assert/strict";

import {
  checkProviderEnv,
  getAvailableModels,
  getProviderModel,
  setProviderModel
} from "../src/core/providers.js";

test("provider env validation reports missing keys", () => {
  const state = checkProviderEnv("azure-openai", {});
  assert.equal(state.ok, false);
  assert.deepEqual(state.missing, ["AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT"]);
});

test("setProviderModel/getProviderModel roundtrip", () => {
  const env: Record<string, string> = {};
  setProviderModel("openai", "gpt-4.1-mini", env);
  assert.equal(getProviderModel("openai", env), "gpt-4.1-mini");
});

test("ollama model list is dynamic from installed models", async () => {
  const fakeFetch = (async () => ({
    ok: true,
    json: async () => ({
      models: [
        { name: "llama3.2:latest" },
        { name: "qwen2.5-coder:7b" }
      ]
    })
  })) as unknown as typeof fetch;

  const models = await getAvailableModels("ollama", { OLLAMA_ENDPOINT: "http://localhost:11434" }, fakeFetch);
  assert.deepEqual(models, ["phi3", "llama3.2", "qwen2.5-coder:7b"]);
});
