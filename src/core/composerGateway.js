import { normalizeComposerOutput, validateComposerOutput } from "./composerSchema.js";

export async function composeWithFallback({
  modelGateway,
  messages,
  primary,
  fallback,
  minConfidence = 0.55,
  retryOnSchemaFail = true,
  retryOnLowConfidence = true
}) {
  const primaryResult = await tryCompose(modelGateway, messages, primary, minConfidence);
  if (primaryResult.ok) return { ...primaryResult, used: "primary" };

  const shouldRetry =
    (primaryResult.reason === "schema_invalid" && retryOnSchemaFail) ||
    (primaryResult.reason === "low_confidence" && retryOnLowConfidence) ||
    primaryResult.reason === "model_error";

  if (!fallback || !shouldRetry) {
    return { ok: false, reason: primaryResult.reason, errors: primaryResult.errors ?? [], used: "primary" };
  }

  const fallbackResult = await tryCompose(modelGateway, messages, fallback, minConfidence);
  if (fallbackResult.ok) return { ...fallbackResult, used: "fallback" };
  return { ok: false, reason: fallbackResult.reason, errors: fallbackResult.errors ?? [], used: "fallback" };
}

async function tryCompose(modelGateway, messages, modelConfig, minConfidence) {
  try {
    const json = await modelGateway.completeJson(messages, {
      provider: modelConfig?.provider,
      model: modelConfig?.model
    });
    const normalized = normalizeComposerOutput(json);
    const valid = validateComposerOutput(normalized);
    if (!valid.ok) return { ok: false, reason: "schema_invalid", errors: valid.errors };
    if (normalized.confidence < minConfidence) {
      return { ok: false, reason: "low_confidence", errors: [`confidence=${normalized.confidence}`], output: normalized };
    }
    return { ok: true, output: normalized };
  } catch (error) {
    return { ok: false, reason: "model_error", errors: [String(error?.message ?? error)] };
  }
}
