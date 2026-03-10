import type { ValidationResult } from "./contracts.js";

export interface ComposerOutput {
  summary: string;
  intent: string;
  reasoning: string;
  evidence: unknown[];
  suggestions: unknown[];
  followUpQuestion: string | null;
  confidence: number;
}

export function validateComposerOutput(value: ComposerOutput | null | undefined): ValidationResult {
  if (!value || typeof value !== "object") return { ok: false, errors: ["Composer output must be object"] };
  const errors: string[] = [];
  if (!value.summary.trim()) errors.push("Missing summary");
  if (!value.intent.trim()) errors.push("Missing intent");
  if (!value.reasoning.trim()) errors.push("Missing reasoning");
  if (!Array.isArray(value.evidence)) errors.push("evidence must be array");
  if (!Array.isArray(value.suggestions)) errors.push("suggestions must be array");
  if (Number.isNaN(value.confidence) || value.confidence < 0 || value.confidence > 1) {
    errors.push("confidence must be number in [0,1]");
  }
  return { ok: errors.length === 0, errors };
}

export function normalizeComposerOutput(value: unknown): ComposerOutput {
  const typed = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const confidence = Number(typed.confidence);
  return {
    summary: String(typed.summary ?? "").trim(),
    intent: String(typed.intent ?? "assist").trim(),
    reasoning: String(typed.reasoning ?? "").trim(),
    evidence: Array.isArray(typed.evidence) ? typed.evidence : [],
    suggestions: Array.isArray(typed.suggestions) ? typed.suggestions : [],
    followUpQuestion:
      typeof typed.followUpQuestion === "string" && typed.followUpQuestion.trim()
        ? typed.followUpQuestion.trim()
        : null,
    confidence: Number.isNaN(confidence) ? 0.5 : Math.max(0, Math.min(1, confidence))
  };
}
