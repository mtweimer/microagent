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
}) {
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

export function validateTrace(trace) {
  const required = [
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
  const missing = required.filter((k) => trace?.[k] === undefined);
  return {
    ok: missing.length === 0,
    missing
  };
}
