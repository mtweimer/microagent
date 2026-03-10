import crypto from "node:crypto";
import { translateRequest } from "./llmTranslator.js";
import { validateActionEnvelope, getRegistryVersion } from "./schema.js";
import { detectDomain } from "../contracts/actionRegistry.js";
import { createTrace } from "../trace/traceSchema.js";
import { classifyIntent } from "./intentPolicy.js";
import { normalizeEnvelopeParams } from "./normalizeParams.js";
import { selectDomainCandidates } from "./candidateSelector.js";
import { composeResponse } from "./responseComposer.js";
import {
  getCapabilityPack,
  suggestSupportedAlternatives
} from "./capabilityPack.js";
import { decideRoute } from "./routerDecision.js";
import { deriveRetrievalPlan } from "./retrievalPlan.js";
import { assembleComposerMessages } from "./promptAssembler.js";
import { resolveFollowupInput } from "./followupResolver.js";
import {
  createSessionRefs,
  resolveOutlookReadParams,
  updateSessionRefsFromCached,
  updateSessionRefsFromExecution
} from "./dispatcherPipeline/sessionRefs.js";
import { resolveDomain } from "./dispatcherPipeline/domainResolution.js";

/**
 * Dispatcher pipeline:
 * 1) add user turn to memory
 * 2) cache lookup
 * 3) domain detect
 * 4) translate + correction loop
 * 5) strict validate
 * 6) execute with selected domain agent
 * 7) write result to memory and cache
 */
export class Dispatcher {
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
    composerConfig
  }) {
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
    this.capabilityPack = getCapabilityPack();
    this.sessionRefs = createSessionRefs();
  }

  async route(input) {
    const traceId = crypto.randomUUID();
    const stageStart = {};
    const stageTimingsMs = {};
    const markStart = (stage) => {
      stageStart[stage] = performance.now();
    };
    const markEnd = (stage) => {
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
      this.memory.addTurn({ role: "assistant", text: JSON.stringify(cached), source: "cache" });
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
          executionError:
            cached.trace?.executionError ?? (cached.status === "error" ? cached.message : null)
        })
      };
    }

    markStart("intent_detect");
    const selection = selectDomainCandidates(input);
    const followup = resolveFollowupInput(input, this.sessionRefs, this.entityGraph);
    const domain = followup?.envelope?.agent
      ? String(followup.envelope.agent).replace(/^ms\./, "")
      : resolveDomain(input, selection, this.sessionRefs);
    markEnd("intent_detect");

    markStart("intent_policy");
    const intent = classifyIntent(input, domain);
    markEnd("intent_policy");

    if (intent.type === "memory_statement") {
      const requestId = `memory-${Date.now()}`;
      const response = {
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

    const routeDecision = followup
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
      const response = {
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
      this.memory.addTurn({ role: "assistant", text: response.finalText, source: "router" });
      markEnd("memory_write_assistant");
      return response;
    }

    if (routeDecision.mode === "chat") {
      return this.composeGeneralChatResponse({ input, traceId, stageTimingsMs, markStart, markEnd });
    }

    if (routeDecision.mode === "clarify") {
      const requestId = `clarify-${Date.now()}`;
      const clarifyingQuestion =
        routeDecision.clarificationQuestion ??
        "I need clarification: is this Outlook, Calendar, Teams, SharePoint, or OneDrive related?";
      const response = {
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

    let translation;
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
          ? this.grammarStore?.lookup(input, domain)
          : this.patternCache?.lookup(input, domain);
      if (learned) {
        translation = {
          envelope: {
            requestId: crypto.randomUUID(),
            schemaVersion: getRegistryVersion(),
            agent: learned.agent,
            action: learned.action,
            params: learned.params ?? {},
            confidence: 0.95,
            requiresConfirmation: false
          },
          source: "pattern_cache",
          validationErrors: []
        };
      }
    }
    if (!translation) {
      translation = await translateRequest(input, domain, this.modelGateway);
    }
    markEnd("translate");

    const typed = resolveOutlookReadParams(
      normalizeEnvelopeParams(translation.envelope),
      this.sessionRefs
    );

    markStart("validate");
    const validation = validateActionEnvelope(typed);
    markEnd("validate");

    if (!validation.ok) {
      const response = {
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
      const response = {
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
    const result = await candidate.execute(typed, {
      memory: this.memory,
      modelGateway: this.modelGateway,
      graphClient: this.graphClient,
      teamsIndex: this.teamsIndex,
      teamsRankingConfig: this.teamsRankingConfig
    });
    markEnd("execute");

    markStart("memory_lookup");
    const memoryRefs = this.memory.query(input, { topK: 3 }).results.map((r) => r.id);
    markEnd("memory_lookup");

    const response = {
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

    if (response.status === "ok") {
      markStart("cache_write");
      this.cache.set(cacheKey, response);
      markEnd("cache_write");
    }

    markStart("memory_write_assistant");
    this.memory.addTurn({ role: "assistant", text: JSON.stringify(response), source: candidate.id });
    markEnd("memory_write_assistant");

    markStart("compose_prompt");
    const narrativeEntries = this.narrativeMemory ? this.narrativeMemory.summarize("today", 6) : [];
    const memoryEvidence = this.memory.query(input, { topK: 5 }).results;
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
      memoryEvidence,
      narrativeEntries
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
    response.retrievalPlan = deriveRetrievalPlan({
      input,
      routeDecision,
      envelope: typed,
      executionResult: result
    });
    if (response.retrievalPlan) {
      response.artifacts.retrievalPlan = response.retrievalPlan;
    }

    if (typed.agent === "ms.outlook" || typed.agent === "ms.calendar" || typed.agent === "ms.teams") {
      this.sessionRefs = updateSessionRefsFromExecution(this.sessionRefs, typed, result);
      response.sessionRefs = { ...this.sessionRefs };
    }

    if (this.entityGraph && result.status === "ok") {
      this.entityGraph.observeExecution(typed, result.artifacts ?? {});
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
          this.grammarStore?.learn(input, domain, typed);
        } else {
          this.patternCache?.learn(input, domain, typed);
        }
      }
    }
    if (this.personaOverlayManager) {
      this.personaOverlayManager.refresh({
        memory: this.memory,
        narrativeMemory: this.narrativeMemory
      });
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
  }) {
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

  getCacheKey(input) {
    const provider = this.modelGateway?.getActiveProvider?.() ?? "none";
    const model = this.modelGateway?.getActiveModel?.(provider) ?? "none";
    const composerVersion = "composer-v6";
    const fingerprint = JSON.stringify({
      strategy: this.composerConfig?.strategy ?? "hybrid_fallback",
      primary: this.composerConfig?.primary ?? null,
      fallback: this.composerConfig?.fallback ?? null
    });
    return `${provider}::${model}::${getRegistryVersion()}::${composerVersion}::${fingerprint}::${input}`;
  }

  async composeGeneralChatResponse({ input, traceId, stageTimingsMs, markStart, markEnd }) {
    const requestId = `chat-${Date.now()}`;
    markStart("compose_prompt");
    const narrativeEntries = this.narrativeMemory ? this.narrativeMemory.summarize("today", 6) : [];
    const memoryEvidence = this.memory.query(input, { topK: 5 }).results;
    markEnd("compose_prompt");

    markStart("compose_model");
    const composed = await composeResponse({
      input,
      actionEnvelope: null,
      executionResult: {
        status: "ok",
        message: ""
      },
      memoryRefs: memoryEvidence.map((r) => r.id),
      personaContext: this.personaContext,
      capabilityPack: this.capabilityPack,
      modelGateway: this.modelGateway,
      composerConfig: this.composerConfig,
      memoryEvidence,
      narrativeEntries
    });
    markEnd("compose_model");

    const response = {
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
      memoryRefs: memoryEvidence.map((r) => r.id),
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
    this.memory.addTurn({ role: "assistant", text: response.finalText, source: "composer" });
    markEnd("memory_write_assistant");
    response.trace.stageTimingsMs = stageTimingsMs;
    return response;
  }

  explainRoute(input) {
    const selection = selectDomainCandidates(input);
    const domain = selection.primary ?? detectDomain(input);
    const intent = classifyIntent(input, domain);
    return decideRoute({ input, domain, selection, intent });
  }

  getCapabilities() {
    return this.capabilityPack;
  }

  previewComposerPrompt(input = "hello") {
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
      memoryEvidence: this.memory.query(input, { topK: 5 }).results,
      narrativeEntries: this.narrativeMemory ? this.narrativeMemory.summarize("today", 6) : [],
      budget: this.composerConfig?.budget ?? {}
    });
    return {
      route,
      capabilityPack: this.capabilityPack,
      persona: this.personaContext,
      prompt: messages
    };
  }
}
