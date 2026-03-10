const LEVELS = {
  low: 1,
  medium: 2,
  high: 3
} as const;

type RiskLevel = keyof typeof LEVELS;

export function normalizeRisk(value: unknown, fallback: RiskLevel = "medium"): RiskLevel {
  const lower = String(value ?? "").toLowerCase();
  return lower in LEVELS ? (lower as RiskLevel) : fallback;
}

export function riskValue(value: unknown): number {
  return LEVELS[normalizeRisk(value)];
}

export function inferActionRisk(actionEnvelope: { action?: string | null } | null | undefined): RiskLevel {
  const action = actionEnvelope?.action;
  if (!action) return "low";
  if (action === "find_events" || action === "search_email") return "low";
  if (action === "schedule_event") return "medium";
  if (action === "send_email") return "high";
  return "medium";
}

export function shouldExecuteCase(caseRisk: unknown, maxAllowedRisk: unknown): boolean {
  return riskValue(caseRisk) <= riskValue(maxAllowedRisk);
}
