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

function hasAny(lower: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(lower));
}

function inferIntent(input: string, routeDecision?: RouteDecision | null, envelope?: ActionEnvelope | null): RetrievalIntent {
  const lower = String(input ?? "").toLowerCase();
  if (/\b(compare|difference|versus|vs\.?|better than)\b/.test(lower)) return "comparative";
  if (/\b(what did .+ want|what was .+ about|what happened in .+ thread|read .+ email|open .+ thread|is that .+ important)\b/.test(lower)) {
    return "exact";
  }
  if (/\b(search|find|look up)\b/.test(lower)) return "lookup";
  if (/\b(what company do i work for|who is .+ in my work|what can you access)\b/.test(lower)) return "lookup";
  if (/\b(should i respond|summarize what matters|what matters|give me the context around)\b/.test(lower)) return "contextual";
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
  for (const acronym of String(input ?? "").match(/\b[A-Z]{2,}\b/g) ?? []) {
    candidates.add(acronym.trim());
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
  intent: RetrievalIntent,
  input: string,
  routeDecision?: RouteDecision | null,
  envelope?: ActionEnvelope | null,
  entities: string[] = []
): string[] {
  const lower = String(input ?? "").toLowerCase();
  const domain = routeDecision?.domain ?? envelope?.agent?.replace(/^ms\./, "") ?? null;
  const teamsSignal = hasAny(lower, [/\bteams\b/, /\bthread\b/, /\bchannel\b/, /\bchat\b/]) || domain === "teams";
  const outlookSignal = hasAny(lower, [/\bemail\b/, /\binbox\b/, /\bmessage\b/]) || domain === "outlook";
  const calendarSignal = hasAny(lower, [/\bcalendar\b/, /\bmeeting\b/, /\bevent\b/]) || domain === "calendar";
  const reviewSignal = hasAny(lower, [/\breview\b/, /\bfollowups?\b/, /\bmiss anything\b/, /\bcontext\b/, /\bwhy\b/]);
  const cacheSignal = hasAny(lower, [/\bagain\b/, /\brepeat\b/, /\bsame\b/, /\bprevious\b/, /\blast time\b/]);
  const sources = new Set<string>();
  switch (intent) {
    case "exact":
      sources.add("session-refs");
      if (teamsSignal) sources.add("teams-index");
      if (outlookSignal || calendarSignal) sources.add("structured-memory");
      if (/\b(what|why|how)\b/.test(lower)) sources.add("structured-memory");
      if (!teamsSignal && !outlookSignal && !calendarSignal && entities.length > 0) sources.add("structured-memory");
      if (!teamsSignal && entities.length > 0 && /\b(want|wanted|ask|asked|need|needed|request|requested)\b/.test(lower)) {
        sources.add("teams-index");
      }
      if (entities.length > 0) sources.add("entity-graph");
      if (cacheSignal && outlookSignal) sources.add("cache");
      break;
    case "lookup":
      sources.add("session-refs");
      sources.add("structured-memory");
      if (teamsSignal) sources.add("teams-index");
      if (entities.length > 0) sources.add("entity-graph");
      if (cacheSignal && outlookSignal) sources.add("cache");
      break;
    case "contextual":
      sources.add("structured-memory");
      sources.add("narrative-memory");
      sources.add("session-refs");
      if (teamsSignal) sources.add("teams-index");
      if (entities.length > 0 || /\b(client|project|company|account)\b/.test(lower)) sources.add("entity-graph");
      break;
    case "timeline":
      sources.add("session-refs");
      sources.add("narrative-memory");
      if (teamsSignal) sources.add("teams-index");
      if (outlookSignal || calendarSignal) sources.add("structured-memory");
      if (entities.length > 0) sources.add("entity-graph");
      break;
    case "comparative":
      sources.add("entity-graph");
      sources.add("structured-memory");
      sources.add("narrative-memory");
      if (teamsSignal) sources.add("teams-index");
      break;
    case "exploratory":
    default:
      sources.add("structured-memory");
      sources.add("session-refs");
      if (reviewSignal) sources.add("narrative-memory");
      if (teamsSignal) sources.add("teams-index");
      if (entities.length > 0) sources.add("entity-graph");
      break;
  }
  return [...sources];
}

export class RetrievalPlanner {
  plan({ input, routeDecision, envelope, executionResult, sessionRefs, entityGraph, retrievalConfig = {} }: RetrievalPlannerInput): RetrievalPlan {
    const intent = inferIntent(input, routeDecision, envelope);
    const entities = inferEntities(input, sessionRefs, entityGraph);
    const sources = inferSources(intent, input, routeDecision, envelope, entities);
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
