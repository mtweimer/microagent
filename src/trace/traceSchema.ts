import type { TraceRecord, ValidationResult } from "../core/contracts.js";

export function createTrace({
  traceId,
  requestId,
  provider,
  model,
  translationSource,
  schemaVersion,
  agent,
  cacheHit,
  stageTimingsMs,
  validationErrors,
  executionError
}: Omit<TraceRecord, "timestamp">): TraceRecord {
  return {
    traceId,
    requestId,
    provider,
    model,
    translationSource,
    schemaVersion,
    agent,
    cacheHit,
    stageTimingsMs,
    validationErrors,
    executionError,
    timestamp: new Date().toISOString()
  };
}

export function validateTrace(trace: TraceRecord | null | undefined): ValidationResult & { missing: string[] } {
  const required: Array<keyof TraceRecord> = [
    "traceId",
    "requestId",
    "provider",
    "model",
    "translationSource",
    "schemaVersion",
    "agent",
    "cacheHit",
    "stageTimingsMs",
    "validationErrors",
    "executionError",
    "timestamp"
  ];
  const missing = required.filter((key) => trace?.[key] === undefined);
  return {
    ok: missing.length === 0,
    errors: [],
    missing
  };
}
