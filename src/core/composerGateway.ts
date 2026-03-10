import { normalizeComposerOutput, validateComposerOutput, type ComposerOutput } from "./composerSchema.js";
import type { ComposerMessage, ModelGatewayLike } from "./contracts.js";

interface ComposeModelConfig {
  provider?: string;
  model?: string;
}

interface ComposeWithFallbackInput {
  modelGateway: ModelGatewayLike;
  messages: ComposerMessage[];
  primary?: ComposeModelConfig;
  fallback?: ComposeModelConfig;
  minConfidence?: number;
  retryOnSchemaFail?: boolean;
  retryOnLowConfidence?: boolean;
}

type ComposeAttemptResult =
  | { ok: true; output: ComposerOutput }
  | { ok: false; reason: "schema_invalid" | "low_confidence" | "model_error"; errors: string[]; output?: ComposerOutput };

export async function composeWithFallback({
  modelGateway,
  messages,
  primary,
  fallback,
  minConfidence = 0.55,
  retryOnSchemaFail = true,
  retryOnLowConfidence = true
}: ComposeWithFallbackInput) {
  const primaryResult = await tryCompose(modelGateway, messages, primary, minConfidence);
  if (primaryResult.ok) return { ...primaryResult, used: "primary" as const };

  const shouldRetry =
    (primaryResult.reason === "schema_invalid" && retryOnSchemaFail) ||
    (primaryResult.reason === "low_confidence" && retryOnLowConfidence) ||
    primaryResult.reason === "model_error";

  if (!fallback || !shouldRetry) {
    return { ok: false as const, reason: primaryResult.reason, errors: primaryResult.errors, used: "primary" as const };
  }

  const fallbackResult = await tryCompose(modelGateway, messages, fallback, minConfidence);
  if (fallbackResult.ok) return { ...fallbackResult, used: "fallback" as const };
  return { ok: false as const, reason: fallbackResult.reason, errors: fallbackResult.errors, used: "fallback" as const };
}

async function tryCompose(
  modelGateway: ModelGatewayLike,
  messages: ComposerMessage[],
  modelConfig: ComposeModelConfig | undefined,
  minConfidence: number
): Promise<ComposeAttemptResult> {
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
    return { ok: false, reason: "model_error", errors: [String(error instanceof Error ? error.message : error)] };
  }
}
