const LEVELS = {
  low: 1,
  medium: 2,
  high: 3
};

export function normalizeRisk(value, fallback = "medium") {
  const lower = String(value ?? "").toLowerCase();
  return LEVELS[lower] ? lower : fallback;
}

export function riskValue(value) {
  return LEVELS[normalizeRisk(value)];
}

export function inferActionRisk(actionEnvelope) {
  const action = actionEnvelope?.action;
  if (!action) return "low";
  if (action === "find_events" || action === "search_email") return "low";
  if (action === "schedule_event") return "medium";
  if (action === "send_email") return "high";
  return "medium";
}

export function shouldExecuteCase(caseRisk, maxAllowedRisk) {
  return riskValue(caseRisk) <= riskValue(maxAllowedRisk);
}
