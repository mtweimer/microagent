import crypto from "node:crypto";
import { translateRequest } from "./llmTranslator.js";
import { validateActionEnvelope, getRegistryVersion } from "./schema.js";
import { detectDomain, listDomains, type DomainName } from "../contracts/actionRegistry.js";
import { createTrace } from "../trace/traceSchema.js";
import { classifyIntent } from "./intentPolicy.js";
import { normalizeEnvelopeParams } from "./normalizeParams.js";
import { selectDomainCandidates } from "./candidateSelector.js";
import { composeResponse } from "./responseComposer.js";
import { getCapabilityPack, suggestSupportedAlternatives } from "./capabilityPack.js";
import { decideRoute } from "./routerDecision.js";
import { deriveRetrievalPlan } from "./retrievalPlan.js";
import { assembleComposerMessages } from "./promptAssembler.js";
import { resolveFollowupInput } from "./followupResolver.js";
import { RetrievalEngine } from "./retrieval/engine/RetrievalEngine.js";
import { buildTranslationCacheKey } from "./cacheKey.js";
import {
  createSessionRefs,
  resolveOutlookReadParams,
  updateSessionRefsFromCached,
  updateSessionRefsFromExecution
} from "./dispatcherPipeline/sessionRefs.js";
import { resolveDomain } from "./dispatcherPipeline/domainResolution.js";
import type {
  ActionEnvelope,
  AgentExecutionResult,
  AnyRecord,
  DispatcherDeps,
  DispatcherResponse,
  FollowupResolution,
  RouteDecision,
  SessionRefs,
  RetrievalResult,
  TraceRecord,
  TranslationResult
} from "./contracts.js";

type StageTimings = Record<string, number>;

type TraceInput = {
  traceId: string;
  requestId: string;
  agent: string;
  cacheHit: boolean;
  translationSource: string;
  stageTimingsMs: StageTimings;
  validationErrors: string[];
  executionError: string | null;
};

type ChatComposeInput = {
  input: string;
  traceId: string;
  stageTimingsMs: StageTimings;
  markStart: (stage: string) => void;
  markEnd: (stage: string) => void;
};

function asRecord(value: unknown): AnyRecord {
  return typeof value === "object" && value !== null ? (value as AnyRecord) : {};
}

function asDomainName(value: string | null): DomainName | null {
  if (!value) return null;
  return listDomains().includes(value as DomainName) ? (value as DomainName) : null;
}

function isConversationalRetrievalPrompt(input: string): boolean {
  const lower = String(input ?? "").toLowerCase();
  return /\b(what did|what happened|what changed|what was that|what about the latest one|latest one|should i respond|is that important|summarize what matters|did i miss anything)\b/.test(lower);
}

export class Dispatcher {
  agents: DispatcherDeps["agents"];
  memory: DispatcherDeps["memory"];
  cache: DispatcherDeps["cache"];
  modelGateway: DispatcherDeps["modelGateway"];
  graphClient: DispatcherDeps["graphClient"];
  teamsIndex: DispatcherDeps["teamsIndex"];
  teamsRankingConfig: AnyRecord;
  entityGraph: DispatcherDeps["entityGraph"];
  personaContext: DispatcherDeps["personaContext"];
  narrativeMemory: DispatcherDeps["narrativeMemory"];
  patternCache: DispatcherDeps["patternCache"];
  grammarStore: DispatcherDeps["grammarStore"];
  personaOverlayManager: DispatcherDeps["personaOverlayManager"];
  cacheConfig: AnyRecord;
  composerConfig: AnyRecord;
  retrievalConfig: AnyRecord;
  capabilityPack: ReturnType<typeof getCapabilityPack>;
  sessionRefs: SessionRefs;

  constructor({
    agents,
    memory,
    cache,
    modelGateway,
    graphClient,
    teamsIndex,
    teamsRankingConfig,
    entityGraph,
    personaContext,
    narrativeMemory,
    patternCache,
    grammarStore,
    personaOverlayManager,
    cacheConfig,
    composerConfig,
    retrievalConfig
  }: DispatcherDeps) {
    this.agents = agents;
    this.memory = memory;
    this.cache = cache;
    this.modelGateway = modelGateway;
    this.graphClient = graphClient;
    this.teamsIndex = teamsIndex;
    this.teamsRankingConfig = teamsRankingConfig ?? {};
    this.entityGraph = entityGraph;
    this.personaContext = personaContext;
    this.narrativeMemory = narrativeMemory;
    this.patternCache = patternCache;
    this.grammarStore = grammarStore;
    this.personaOverlayManager = personaOverlayManager;
    this.cacheConfig = cacheConfig ?? { enabled: true, grammarSystem: "completionBased" };
    this.composerConfig = composerConfig ?? {};
    this.retrievalConfig = this.normalizeRetrievalConfig(retrievalConfig);
    this.capabilityPack = getCapabilityPack();
    this.sessionRefs = createSessionRefs();
  }

  async route(input: string): Promise<DispatcherResponse> {
    const traceId = crypto.randomUUID();
    const stageStart: Record<string, number> = {};
    const stageTimingsMs: StageTimings = {};
    const markStart = (stage: string): void => {
      stageStart[stage] = performance.now();
    };
    const markEnd = (stage: string): void => {
      const start = stageStart[stage] ?? performance.now();
      stageTimingsMs[stage] = Math.round((performance.now() - start) * 1000) / 1000;
    };

    markStart("memory_write_user");
    this.memory.addTurn({ role: "user", text: input, source: "cli" });
    markEnd("memory_write_user");

    const cacheKey = this.getCacheKey(input);
    markStart("cache_lookup");
    const cached = this.cache.get(cacheKey);
    markEnd("cache_lookup");
    if (cached && cached.status === "ok") {
      this.sessionRefs = updateSessionRefsFromCached(this.sessionRefs, cached);
      markStart("memory_write_assistant");
      this.memory.addTurn({ role: "assistant", text: cached.finalText ?? cached.message, source: "cache" });
      markEnd("memory_write_assistant");

      return {
        ...cached,
        trace: this.buildTrace({
          traceId,
          requestId: cached.requestId,
          agent: cached.trace?.agent ?? "cache",
          cacheHit: true,
          translationSource: cached.trace?.translationSource ?? "cache",
          stageTimingsMs,
          validationErrors: [],
          executionError: cached.trace?.executionError ?? null
        })
      };
    }

    markStart("intent_detect");
    const selection = selectDomainCandidates(input);
    const followup = resolveFollowupInput(input, this.sessionRefs) as FollowupResolution | null;
    const domain = followup?.envelope?.agent
      ? String(followup.envelope.agent).replace(/^ms\./, "")
      : resolveDomain(input, selection, this.sessionRefs);
    markEnd("intent_detect");

    markStart("intent_policy");
    const intent = classifyIntent(input, domain);
    markEnd("intent_policy");

    if (intent.type === "memory_statement") {
      const requestId = `memory-${Date.now()}`;
      const response: DispatcherResponse = {
        requestId,
        status: "ok",
        message:
          "Noted. I saved that context in memory. If you want an action, ask with an explicit command like 'search my email for ...' or 'schedule ...'.",
        finalText:
          "Noted. I saved that context in memory. If you want an action, ask with an explicit command like 'search my email for ...' or 'schedule ...'.",
        artifacts: {
          intent: "memory_statement"
        },
        memoryRefs: [],
        trace: this.buildTrace({
          traceId,
          requestId,
          agent: "dispatcher",
          cacheHit: false,
          translationSource: "none",
          stageTimingsMs,
          validationErrors: [],
          executionError: null
        })
      };

      markStart("memory_write_assistant");
      this.memory.addTurn({ role: "assistant", text: response.message, source: "dispatcher" });
      markEnd("memory_write_assistant");
      return response;
    }

    const routeDecision: RouteDecision = followup
      ? {
          mode: "retrieval",
          domain,
          actionHint: followup.envelope.action,
          confidence: 0.98,
          needsClarification: false,
          clarificationQuestion: null,
          unsupportedReason: null
        }
      : decideRoute({ input, domain, selection, intent });

    if (routeDecision.mode === "unsupported") {
      const requestId = `unsupported-${Date.now()}`;
      const alternatives = suggestSupportedAlternatives(input);
      const response: DispatcherResponse = {
        requestId,
        status: "unsupported",
        message:
          "I can’t perform that capability yet. I can help with Outlook and Calendar workflows.",
        finalText:
          `I can’t perform that capability yet. I can help with Outlook and Calendar workflows.\n` +
          `Try one of these instead:\n- ${alternatives.join("\n- ")}`,
        artifacts: {
          unsupported: {
            reason: routeDecision.unsupportedReason,
            alternatives
          }
        },
        router: routeDecision,
        capabilityGrounded: true,
        memoryRefs: [],
        trace: this.buildTrace({
          traceId,
          requestId,
          agent: "router",
          cacheHit: false,
          translationSource: "none",
          stageTimingsMs,
          validationErrors: [],
          executionError: null
        })
      };
      markStart("memory_write_assistant");
      this.memory.addTurn({ role: "assistant", text: response.finalText ?? response.message, source: "router" });
      markEnd("memory_write_assistant");
      return response;
    }

    if (routeDecision.mode === "chat") {
      return this.composeGeneralChatResponse({ input, traceId, stageTimingsMs, markStart, markEnd });
    }

    if (routeDecision.mode === "clarify") {
      if (isConversationalRetrievalPrompt(input)) {
        return this.composeGeneralChatResponse({ input, traceId, stageTimingsMs, markStart, markEnd });
      }
      const requestId = `clarify-${Date.now()}`;
      const clarifyingQuestion =
        routeDecision.clarificationQuestion ??
        "I need clarification: is this Outlook, Calendar, Teams, SharePoint, or OneDrive related?";
      const response: DispatcherResponse = {
        requestId,
        status: "clarify",
        message: clarifyingQuestion,
        finalText: clarifyingQuestion,
        artifacts: {
          clarification: {
            type: selection.ambiguous ? "clarify_multiple_possible_action" : "clarify_domain",
            question: clarifyingQuestion,
            options: selection.candidates.map((c) => c.domain)
          }
        },
        router: routeDecision,
        capabilityGrounded: true,
        memoryRefs: [],
        trace: this.buildTrace({
          traceId,
          requestId,
          agent: "dispatcher",
          cacheHit: false,
          translationSource: "none",
          stageTimingsMs,
          validationErrors: [],
          executionError: null
        })
      };

      markStart("memory_write_assistant");
      this.memory.addTurn({ role: "assistant", text: response.message, source: "dispatcher" });
      markEnd("memory_write_assistant");
      return response;
    }

    let translation: TranslationResult | null = null;
    markStart("translate");
    if (followup) {
      translation = {
        envelope: followup.envelope,
        source: followup.source,
        validationErrors: []
      };
    } else if (this.cacheConfig?.enabled && routeDecision.mode === "retrieval") {
      const learned =
        this.cacheConfig.grammarSystem === "nfa"
          ? (this.grammarStore as { lookup?: (query: string, domainName: string | null) => unknown } | undefined)?.lookup?.(input, domain)
          : (this.patternCache as { lookup?: (query: string, domainName: string | null) => unknown } | undefined)?.lookup?.(input, domain);
      if (learned) {
        const learnedRecord = asRecord(learned);
        translation = {
          envelope: {
            requestId: crypto.randomUUID(),
            schemaVersion: getRegistryVersion(),
            agent: String(learnedRecord.agent ?? ""),
            action: String(learnedRecord.action ?? ""),
            params: asRecord(learnedRecord.params),
            confidence: 0.95,
            requiresConfirmation: false
          },
          source: "pattern_cache",
          validationErrors: []
        };
      }
    }
    if (!translation) {
      const translationDomain = asDomainName(domain) ?? "outlook";
      translation = (await translateRequest(input, translationDomain, this.modelGateway)) as TranslationResult;
    }
    markEnd("translate");

    const typed = resolveOutlookReadParams(
      normalizeEnvelopeParams(translation.envelope) as ActionEnvelope,
      this.sessionRefs
    );
    if (!typed) {
      return {
        requestId: translation.envelope.requestId,
        status: "error",
        message: "Normalized action envelope was empty.",
        finalText: "Normalized action envelope was empty.",
        artifacts: { translationSource: translation.source },
        memoryRefs: [],
        trace: this.buildTrace({
          traceId,
          requestId: translation.envelope.requestId,
          agent: "translator",
          cacheHit: false,
          translationSource: translation.source,
          stageTimingsMs,
          validationErrors: [],
          executionError: "Normalized action envelope was empty."
        })
      };
    }

    markStart("validate");
    const validation = validateActionEnvelope(typed);
    markEnd("validate");

    if (!validation.ok) {
      const response: DispatcherResponse = {
        requestId: typed.requestId,
        status: "error",
        message: `Translation validation failed: ${validation.errors.join(", ")}`,
        finalText: `Translation validation failed: ${validation.errors.join(", ")}`,
        artifacts: { typed, translationSource: translation.source },
        memoryRefs: [],
        trace: this.buildTrace({
          traceId,
          requestId: typed.requestId,
          agent: "translator",
          cacheHit: false,
          translationSource: translation.source,
          stageTimingsMs,
          validationErrors: validation.errors,
          executionError: null
        })
      };

      markStart("memory_write_assistant");
      this.memory.addTurn({ role: "assistant", text: response.message, source: "translator" });
      markEnd("memory_write_assistant");
      return response;
    }

    markStart("agent_resolve");
    const candidate = this.agents.find((a) => a.id === typed.agent);
    markEnd("agent_resolve");

    if (!candidate) {
      const loadedAgents = this.agents.map((a) => a.id);
      const hint =
        loadedAgents.length > 0
          ? `Loaded agents: ${loadedAgents.join(", ")}. Enable '${typed.agent}' in profile.agents.enabled and restart.`
          : "No agents are currently loaded. Check profile.agents.enabled and plugin paths.";
      const response: DispatcherResponse = {
        requestId: typed.requestId,
        status: "error",
        message: `No agent available for ${typed.agent}. ${hint}`,
        finalText: `No agent available for ${typed.agent}. ${hint}`,
        artifacts: { typed, translationSource: translation.source },
        memoryRefs: [],
        trace: this.buildTrace({
          traceId,
          requestId: typed.requestId,
          agent: "dispatcher",
          cacheHit: false,
          translationSource: translation.source,
          stageTimingsMs,
          validationErrors: [],
          executionError: `No agent available for ${typed.agent}`
        })
      };

      markStart("memory_write_assistant");
      this.memory.addTurn({ role: "assistant", text: response.message, source: "dispatcher" });
      markEnd("memory_write_assistant");
      return response;
    }

    markStart("execute");
    const executionContext = {
      memory: this.memory,
      modelGateway: this.modelGateway,
      graphClient: this.graphClient,
      teamsRankingConfig: this.teamsRankingConfig,
      ...(this.teamsIndex !== undefined ? { teamsIndex: this.teamsIndex } : {})
    };
    const result: AgentExecutionResult = await candidate.execute(typed, executionContext);
    markEnd("execute");

    markStart("memory_lookup");
    const memoryRefs = this.memory.query(input, { topK: 3 }).results.map((r) => r.id);
    markEnd("memory_lookup");

    const response: DispatcherResponse = {
      requestId: typed.requestId,
      status: result.status,
      message: result.message,
      artifacts: {
        action: typed,
        translationSource: translation.source,
        result: result.artifacts ?? {}
      },
      memoryRefs,
      trace: this.buildTrace({
        traceId,
        requestId: typed.requestId,
        agent: candidate.id,
        cacheHit: false,
        translationSource: translation.source,
        stageTimingsMs,
        validationErrors: [],
        executionError: result.status === "error" ? result.message : null
      })
    };

    markStart("compose_prompt");
    const retrieval = await this.buildRetrievalResult({
      input,
      routeDecision,
      envelope: typed,
      executionResult: result
    });
    markEnd("compose_prompt");

    markStart("compose_model");
    const composed = await composeResponse({
      input,
      actionEnvelope: typed,
      executionResult: result,
      memoryRefs,
      personaContext: this.personaContext,
      capabilityPack: this.capabilityPack,
      modelGateway: this.modelGateway,
      composerConfig: this.composerConfig,
      retrieval
    });
    markEnd("compose_model");

    response.finalText = composed.finalText;
    response.conversation = composed.conversation;
    response.evidence = composed.evidence;
    response.suggestedActions = composed.suggestedActions;
    response.conversationMode = composed.conversationMode;
    response.composer = composed.composer;
    response.router = routeDecision;
    response.capabilityGrounded = true;
    response.retrieval = retrieval;
    response.retrievalPlan = deriveRetrievalPlan({
      input,
      routeDecision,
      envelope: typed,
      executionResult: result
    }) as AnyRecord | null;
    if (response.retrievalPlan) {
      response.artifacts.retrievalPlan = response.retrievalPlan;
    }
    response.artifacts.retrieval = retrieval;

    markStart("memory_write_assistant");
    this.memory.addTurn({ role: "assistant", text: response.finalText ?? response.message, source: candidate.id });
    markEnd("memory_write_assistant");

    if (typed.agent === "ms.outlook" || typed.agent === "ms.calendar" || typed.agent === "ms.teams") {
      this.sessionRefs = updateSessionRefsFromExecution(this.sessionRefs, typed, result);
      response.sessionRefs = { ...this.sessionRefs };
    }

    if (this.entityGraph && result.status === "ok") {
      this.entityGraph.observeExecution?.(typed, asRecord(result.artifacts));
    }

    if (this.narrativeMemory && result.status === "ok") {
      this.narrativeMemory.append({
        kind: "summary",
        text: composed.finalText,
        metadata: {
          requestId: typed.requestId,
          agent: typed.agent,
          action: typed.action
        }
      });
    }
    if (this.cacheConfig?.enabled && result.status === "ok" && routeDecision.mode === "retrieval") {
      if (typed.action === "search_email" || typed.action === "find_events") {
        if (this.cacheConfig.grammarSystem === "nfa") {
          (this.grammarStore as { learn?: (query: string, domainName: string | null, envelope: ActionEnvelope) => void } | undefined)?.learn?.(input, domain, typed);
        } else {
          (this.patternCache as { learn?: (query: string, domainName: string | null, envelope: ActionEnvelope) => void } | undefined)?.learn?.(input, domain, typed);
        }
      }
    }
    if (this.personaOverlayManager) {
      this.personaOverlayManager.refresh({
        memory: this.memory,
        narrativeMemory: this.narrativeMemory ?? null
      });
    }

    if (response.status === "ok") {
      markStart("cache_write");
      this.cache.set(cacheKey, response);
      markEnd("cache_write");
    }

    response.trace.stageTimingsMs = stageTimingsMs;
    return response;
  }

  buildTrace({
    traceId,
    requestId,
    agent,
    cacheHit,
    translationSource,
    stageTimingsMs,
    validationErrors,
    executionError
  }: TraceInput): TraceRecord {
    const provider = this.modelGateway?.getActiveProvider?.() ?? "none";
    const model = this.modelGateway?.getActiveModel?.(provider) ?? "none";
    return createTrace({
      traceId,
      requestId,
      provider,
      model,
      translationSource,
      schemaVersion: getRegistryVersion(),
      agent,
      cacheHit,
      stageTimingsMs,
      validationErrors,
      executionError
    });
  }

  getCacheKey(input: string): string {
    const provider = this.modelGateway?.getActiveProvider?.() ?? "none";
    const model = this.modelGateway?.getActiveModel?.(provider) ?? "none";
    return buildTranslationCacheKey({
      input,
      provider,
      model,
      composerConfig: this.composerConfig
    });
  }

  async composeGeneralChatResponse({ input, traceId, stageTimingsMs, markStart, markEnd }: ChatComposeInput): Promise<DispatcherResponse> {
    const requestId = `chat-${Date.now()}`;
    markStart("compose_prompt");
    const retrieval = await this.buildRetrievalResult({
      input,
      routeDecision: {
        mode: "chat",
        domain: null,
        actionHint: null,
        confidence: 0.8,
        needsClarification: false,
        clarificationQuestion: null,
        unsupportedReason: null
      },
      envelope: null,
      executionResult: {
        status: "ok",
        message: ""
      }
    });
    markEnd("compose_prompt");

    markStart("compose_model");
    const composed = await composeResponse({
      input,
      actionEnvelope: null,
      executionResult: {
        status: "ok",
        message: ""
      },
      memoryRefs: retrieval.selectedEvidence.map((r) => r.id),
      personaContext: this.personaContext,
      capabilityPack: this.capabilityPack,
      modelGateway: this.modelGateway,
      composerConfig: this.composerConfig,
      retrieval
    });
    markEnd("compose_model");

    const response: DispatcherResponse = {
      requestId,
      status: "ok",
      message: composed.finalText,
      finalText: composed.finalText,
      artifacts: {
        mode: "general_chat"
      },
      evidence: composed.evidence,
      suggestedActions: composed.suggestedActions,
      conversation: composed.conversation,
      conversationMode: "chat",
      composer: composed.composer,
      retrieval,
      router: {
        mode: "chat",
        domain: null,
        actionHint: null,
        confidence: 0.8,
        needsClarification: false,
        clarificationQuestion: null,
        unsupportedReason: null
      },
      capabilityGrounded: true,
      memoryRefs: retrieval.selectedEvidence.map((r) => r.id),
      trace: this.buildTrace({
        traceId,
        requestId,
        agent: "composer",
        cacheHit: false,
        translationSource: "none",
        stageTimingsMs,
        validationErrors: [],
        executionError: null
      })
    };

    markStart("memory_write_assistant");
    this.memory.addTurn({ role: "assistant", text: response.finalText ?? response.message, source: "composer" });
    markEnd("memory_write_assistant");
    response.trace.stageTimingsMs = stageTimingsMs;
    return response;
  }

  explainRoute(input: string): RouteDecision {
    const selection = selectDomainCandidates(input);
    const domain = selection.primary ?? detectDomain(input);
    const intent = classifyIntent(input, domain);
    return decideRoute({ input, domain, selection, intent });
  }

  getCapabilities(): ReturnType<typeof getCapabilityPack> {
    return this.capabilityPack;
  }

  previewComposerPrompt(input = "hello"): {
    route: RouteDecision;
    capabilityPack: ReturnType<typeof getCapabilityPack>;
    persona: DispatcherDeps["personaContext"];
    prompt: ReturnType<typeof assembleComposerMessages>;
  } {
    const selection = selectDomainCandidates(input);
    const domain = selection.primary ?? detectDomain(input);
    const intent = classifyIntent(input, domain);
    const route = decideRoute({ input, domain, selection, intent });
    const messages = assembleComposerMessages({
      input,
      actionEnvelope: null,
      executionResult: { status: "ok", message: "" },
      personaContext: this.personaContext,
      capabilityPack: this.capabilityPack,
      retrieval: null,
      budget: this.composerConfig?.budget ?? {}
    });
    return {
      route,
      capabilityPack: this.capabilityPack,
      persona: this.personaContext,
      prompt: messages
    };
  }

  async buildRetrievalResult({
    input,
    routeDecision,
    envelope,
    executionResult,
    excludeMemoryIds = []
  }: {
    input: string;
    routeDecision: RouteDecision | null;
    envelope: ActionEnvelope | null;
    executionResult: AgentExecutionResult | null;
    excludeMemoryIds?: Array<string | number>;
  }): Promise<RetrievalResult> {
    const engine = new RetrievalEngine({
      memory: this.memory,
      cache: this.cache,
      getCacheKey: (query: string) => this.getCacheKey(query),
      sessionRefs: this.sessionRefs,
      entityGraph: this.entityGraph ?? null,
      teamsIndex: this.teamsIndex ?? null,
      narrativeMemory: this.narrativeMemory ?? null,
      retrievalConfig: this.retrievalConfig
    });
    return engine.retrieve({ input, routeDecision, envelope, executionResult, excludeMemoryIds });
  }

  normalizeRetrievalConfig(configuredValue: unknown): AnyRecord {
    const configured = typeof configuredValue === "object" && configuredValue !== null
      ? configuredValue
      : {};
    return {
      maxItems: 10,
      tokenBudget: 1800,
      ...configured
    };
  }
}
