import type {
  ActionEnvelope,
  AgentExecutionResult,
  RetrievalIntent,
  RetrievalPlan,
  RouteDecision,
  SessionRefs,
  EntityGraphLike,
  AnyRecord
} from "../../contracts.js";

interface RetrievalPlannerInput {
  input: string;
  routeDecision?: RouteDecision | null;
  envelope?: ActionEnvelope | null;
  executionResult?: AgentExecutionResult | null;
  sessionRefs?: SessionRefs | null;
  entityGraph?: EntityGraphLike | null;
  retrievalConfig?: AnyRecord;
}

function tokenize(text: string): string[] {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9@._-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function inferIntent(input: string, routeDecision?: RouteDecision | null, envelope?: ActionEnvelope | null): RetrievalIntent {
  const lower = String(input ?? "").toLowerCase();
  if (/\b(compare|difference|versus|vs\.?|better than)\b/.test(lower)) return "comparative";
  if (/\b(today|yesterday|this week|timeline|before|after|when)\b/.test(lower)) return "timeline";
  if (/\b(?:why|context|around|miss anything|review|followups?)\b/.test(lower)) return "contextual";
  if (/\b(?:show|read|open|exact|specific|latest|last)\b/.test(lower)) return "exact";
  if (routeDecision?.mode === "retrieval" || envelope?.action?.includes("search") || envelope?.action?.includes("find")) {
    return "lookup";
  }
  return "exploratory";
}

function inferEntities(input: string, sessionRefs?: SessionRefs | null, entityGraph?: EntityGraphLike | null): string[] {
  const tokens = tokenize(input);
  const candidates = new Set<string>();
  for (const chunk of String(input ?? "").match(/[A-Z][A-Za-z0-9&<>_-]+(?:\s+[A-Z][A-Za-z0-9&<>_-]+){0,4}/g) ?? []) {
    candidates.add(chunk.trim());
  }
  for (const name of sessionRefs?.entities.lastNames ?? []) {
    if (tokens.some((token) => name.toLowerCase().includes(token))) candidates.add(name);
  }
  for (const token of tokens) {
    if (token.length < 3) continue;
    const lookup = entityGraph?.lookup?.(token, 3);
    for (const entity of lookup?.entities ?? []) {
      candidates.add(entity.name);
    }
  }
  return [...candidates].slice(0, 8);
}

function inferSources(
  input: string,
  routeDecision?: RouteDecision | null,
  envelope?: ActionEnvelope | null,
  entities: string[] = []
): string[] {
  const lower = String(input ?? "").toLowerCase();
  const domain = routeDecision?.domain ?? envelope?.agent?.replace(/^ms\./, "") ?? null;
  const sources = new Set<string>();
  sources.add("session-refs");
  sources.add("structured-memory");
  if (domain === "teams" || envelope?.agent === "ms.teams" || lower.includes("teams")) {
    sources.add("teams-index");
    sources.add("narrative-memory");
  }
  if (domain === "outlook" || lower.includes("email") || lower.includes("inbox")) {
    sources.add("cache");
  }
  if (entities.length > 0 || /\b(client|project|company|account)\b/.test(lower)) {
    sources.add("entity-graph");
  }
  if (/\breview|followups?|miss anything|context|why\b/.test(lower)) {
    sources.add("narrative-memory");
    sources.add("entity-graph");
  }
  return [...sources];
}

export class RetrievalPlanner {
  plan({ input, routeDecision, envelope, executionResult, sessionRefs, entityGraph, retrievalConfig = {} }: RetrievalPlannerInput): RetrievalPlan {
    const intent = inferIntent(input, routeDecision, envelope);
    const entities = inferEntities(input, sessionRefs, entityGraph);
    const sources = inferSources(input, routeDecision, envelope, entities);
    const domain = routeDecision?.domain ?? envelope?.agent?.replace(/^ms\./, "") ?? null;
    const action = envelope?.action ?? routeDecision?.actionHint ?? null;
    const profile = typeof retrievalConfig === "object" && retrievalConfig !== null ? retrievalConfig : {};
    const profileBudget = typeof profile.tokenBudget === "number" ? profile.tokenBudget : undefined;
    const defaultMaxItems = intent === "contextual" || intent === "timeline" ? 12 : intent === "exact" ? 6 : 10;
    const defaultBudget = intent === "contextual" || intent === "timeline" ? 2200 : 1400;
    return {
      intent,
      query: input,
      entities,
      sources,
      traversalMode: "none",
      maxItems: Math.max(4, Number(profile.maxItems ?? defaultMaxItems)),
      maxDepth: 1,
      tokenBudget: Math.max(800, Number(profileBudget ?? defaultBudget)),
      domain,
      action,
      constraints: {
        routeMode: routeDecision?.mode ?? null,
        executionStatus: executionResult?.status ?? null
      }
    };
  }
}
