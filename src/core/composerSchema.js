export function validateComposerOutput(value) {
  if (!value || typeof value !== "object") return { ok: false, errors: ["Composer output must be object"] };
  const errors = [];
  if (typeof value.summary !== "string" || !value.summary.trim()) {
    errors.push("Missing summary");
  }
  if (typeof value.intent !== "string" || !value.intent.trim()) {
    errors.push("Missing intent");
  }
  if (typeof value.reasoning !== "string" || !value.reasoning.trim()) {
    errors.push("Missing reasoning");
  }
  if (!Array.isArray(value.evidence)) {
    errors.push("evidence must be array");
  }
  if (!Array.isArray(value.suggestions)) {
    errors.push("suggestions must be array");
  }
  const confidence = Number(value.confidence);
  if (Number.isNaN(confidence) || confidence < 0 || confidence > 1) {
    errors.push("confidence must be number in [0,1]");
  }
  return { ok: errors.length === 0, errors };
}

export function normalizeComposerOutput(value) {
  const confidence = Number(value?.confidence);
  return {
    summary: String(value?.summary ?? "").trim(),
    intent: String(value?.intent ?? "assist").trim(),
    reasoning: String(value?.reasoning ?? "").trim(),
    evidence: Array.isArray(value?.evidence) ? value.evidence : [],
    suggestions: Array.isArray(value?.suggestions) ? value.suggestions : [],
    followUpQuestion:
      typeof value?.followUpQuestion === "string" && value.followUpQuestion.trim()
        ? value.followUpQuestion.trim()
        : null,
    confidence: Number.isNaN(confidence) ? 0.5 : Math.max(0, Math.min(1, confidence))
  };
}
