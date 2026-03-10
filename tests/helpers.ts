import crypto from "node:crypto";
import { InMemoryTranslationCache } from "../src/core/cache.js";
import type {
  ActionEnvelope,
  AgentExecutionContext,
  AgentExecutionResult,
  AnyRecord,
  DispatcherDeps,
  DispatcherResponse,
  ExecutionStatus,
  ModelGatewayLike,
  RouteDecision
} from "../src/core/contracts.js";
import { StructuredTurnMemory } from "../src/core/memory.js";
import { createSessionRefs } from "../src/core/dispatcherPipeline/sessionRefs.js";

export function makeEnvelope(overrides: Partial<ActionEnvelope> = {}): ActionEnvelope {
  return {
    requestId: overrides.requestId ?? crypto.randomUUID(),
    schemaVersion: overrides.schemaVersion ?? "1.0.0",
    agent: overrides.agent ?? "ms.outlook",
    action: overrides.action ?? "search_email",
    params: overrides.params ?? {},
    ...(typeof overrides.confidence === "number" ? { confidence: overrides.confidence } : {}),
    ...(typeof overrides.requiresConfirmation === "boolean"
      ? { requiresConfirmation: overrides.requiresConfirmation }
      : {})
  };
}

export function makeExecutionContext(
  overrides: Partial<AgentExecutionContext> = {}
): AgentExecutionContext {
  return {
    memory: overrides.memory ?? new StructuredTurnMemory(),
    modelGateway: overrides.modelGateway ?? null,
    graphClient: overrides.graphClient ?? null,
    ...(overrides.teamsIndex ? { teamsIndex: overrides.teamsIndex } : {}),
    ...(overrides.teamsRankingConfig ? { teamsRankingConfig: overrides.teamsRankingConfig } : {}),
    ...(overrides.entityGraph ? { entityGraph: overrides.entityGraph } : {})
  };
}

export function makeDispatcherDeps(overrides: Partial<DispatcherDeps> = {}): DispatcherDeps {
  return {
    agents: overrides.agents ?? [],
    memory: overrides.memory ?? new StructuredTurnMemory(),
    cache: overrides.cache ?? new InMemoryTranslationCache(),
    modelGateway: overrides.modelGateway ?? null,
    graphClient: overrides.graphClient ?? null,
    ...(overrides.teamsIndex ? { teamsIndex: overrides.teamsIndex } : {}),
    ...(overrides.teamsRankingConfig ? { teamsRankingConfig: overrides.teamsRankingConfig } : {}),
    ...(overrides.entityGraph ? { entityGraph: overrides.entityGraph } : {}),
    ...(overrides.personaContext ? { personaContext: overrides.personaContext } : {}),
    ...(overrides.narrativeMemory ? { narrativeMemory: overrides.narrativeMemory } : {}),
    ...(overrides.patternCache ? { patternCache: overrides.patternCache } : {}),
    ...(overrides.grammarStore ? { grammarStore: overrides.grammarStore } : {}),
    ...(overrides.personaOverlayManager ? { personaOverlayManager: overrides.personaOverlayManager } : {}),
    ...(overrides.cacheConfig ? { cacheConfig: overrides.cacheConfig } : {}),
    ...(overrides.composerConfig ? { composerConfig: overrides.composerConfig } : {})
  };
}

export function makeExecutionResult(
  overrides: Partial<AgentExecutionResult> = {}
): AgentExecutionResult {
  return {
    status: overrides.status ?? "ok",
    message: overrides.message ?? "ok",
    ...(overrides.artifacts ? { artifacts: overrides.artifacts } : {})
  };
}

export function makeDispatcherResponse(
  overrides: Partial<DispatcherResponse> = {}
): DispatcherResponse {
  const requestId = overrides.requestId ?? crypto.randomUUID();
  const action = overrides.artifacts && "action" in overrides.artifacts
    ? overrides.artifacts.action
    : undefined;
  return {
    requestId,
    status: overrides.status ?? "ok",
    message: overrides.message ?? "ok",
    artifacts: overrides.artifacts ?? {},
    memoryRefs: overrides.memoryRefs ?? [],
    trace: overrides.trace ?? {
      traceId: crypto.randomUUID(),
      requestId,
      provider: "test",
      model: "test",
      translationSource: "test",
      schemaVersion: action?.schemaVersion ?? "1.0.0",
      agent: action?.agent ?? "test",
      cacheHit: false,
      stageTimingsMs: {},
      validationErrors: [],
      executionError: null,
      timestamp: new Date().toISOString()
    },
    ...(typeof overrides.finalText === "string" ? { finalText: overrides.finalText } : {}),
    ...(overrides.evidence ? { evidence: overrides.evidence } : {}),
    ...(overrides.suggestedActions ? { suggestedActions: overrides.suggestedActions } : {}),
    ...(overrides.conversation ? { conversation: overrides.conversation } : {}),
    ...(overrides.conversationMode ? { conversationMode: overrides.conversationMode } : {}),
    ...(overrides.composer ? { composer: overrides.composer } : {}),
    ...(overrides.router ? { router: overrides.router } : {}),
    ...(typeof overrides.capabilityGrounded === "boolean"
      ? { capabilityGrounded: overrides.capabilityGrounded }
      : {}),
    ...(overrides.retrievalPlan ? { retrievalPlan: overrides.retrievalPlan } : {}),
    ...(overrides.sessionRefs ? { sessionRefs: overrides.sessionRefs } : {})
  };
}

export function makeRouteDecision(overrides: Partial<RouteDecision> = {}): RouteDecision {
  return {
    mode: overrides.mode ?? "retrieval",
    domain: overrides.domain ?? null,
    actionHint: overrides.actionHint ?? null,
    confidence: overrides.confidence ?? 1,
    needsClarification: overrides.needsClarification ?? false,
    clarificationQuestion: overrides.clarificationQuestion ?? null,
    unsupportedReason: overrides.unsupportedReason ?? null
  };
}

export function makeModelGateway(
  overrides: Partial<ModelGatewayLike> = {}
): ModelGatewayLike {
  return {
    getActiveProvider: overrides.getActiveProvider ?? (() => "ollama"),
    getActiveModel: overrides.getActiveModel ?? (() => "test-model"),
    completeJson: overrides.completeJson ?? (async () => ({})),
    completeText: overrides.completeText ?? (async () => "")
  };
}

export function makeSessionRefs() {
  return createSessionRefs();
}
