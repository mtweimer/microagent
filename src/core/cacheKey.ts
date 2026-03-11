import { getRegistryVersion } from "./schema.js";
import type { AnyRecord } from "./contracts.js";

export function buildTranslationCacheKey({
  input,
  provider,
  model,
  composerConfig
}: {
  input: string;
  provider: string;
  model: string;
  composerConfig?: AnyRecord;
}): string {
  const composerVersion = "composer-v6";
  const fingerprint = JSON.stringify({
    strategy: composerConfig?.strategy ?? "hybrid_fallback",
    primary: composerConfig?.primary ?? null,
    fallback: composerConfig?.fallback ?? null
  });
  return `${provider}::${model}::${getRegistryVersion()}::${composerVersion}::${fingerprint}::${input}`;
}
