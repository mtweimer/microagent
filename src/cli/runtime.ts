// @ts-nocheck
import readline from "node:readline";
import { Dispatcher } from "../core/dispatcher.js";
import { FileBackedTranslationCache } from "../core/fileCache.js";
import { createMemoryStore } from "../core/memoryFactory.js";
import { loadEnvFile } from "../core/env.js";
import { applyProfileToEnv, loadProfile } from "../core/profile.js";
import { ModelGateway } from "../providers/modelGateway.js";
import { createDefaultAgents, getAgentCatalog } from "../agents/catalog.js";
import { createGraphClient } from "../graph/factory.js";
import { loadPersonaContext } from "../core/personaContext.js";
import { NarrativeMemory } from "../core/narrativeMemory.js";
import { validateActionEnvelope, getRegistryVersion } from "../core/schema.js";
import crypto from "node:crypto";
import { FileBackedPatternCache } from "../core/patternCache.js";
import { PersonaOverlayManager } from "../core/personaOverlayManager.js";
import { FileBackedGrammarStore } from "../core/grammarStore.js";
import { probeTeamsAccess } from "../agents/teams/actions/_teamsGraph.js";
import { composeResponse } from "../core/responseComposer.js";
import { TeamsIndex } from "../core/teamsIndex.js";
import { EntityGraph } from "../core/entityGraph.js";
import { runReviewOrchestrator } from "../core/reviewOrchestrator.js";
import {
  updateSessionRefsFromExecution,
  updateSessionRefsFromReview
} from "../core/dispatcherPipeline/sessionRefs.js";

export async function buildRuntime(profileName = "default") {
  const envInfo = loadEnvFile(".env");
  const { profile, filePath } = loadProfile(profileName);
  applyProfileToEnv(profile, process.env);

  const modelGateway = new ModelGateway(process.env);
  const memory = createMemoryStore(profile);
  const cache = new FileBackedTranslationCache(`./data/cache-${profileName}.json`);
  const patternCache = new FileBackedPatternCache(`./data/pattern-cache-${profileName}.json`);
  const grammarStore = new FileBackedGrammarStore(`./data/grammars-${profileName}.json`);
  const graphState = createGraphClient(profile, process.env);
  const personaContext = loadPersonaContext(profileName);
  const narrativeMemory = new NarrativeMemory(`./data/narrative-${profileName}.jsonl`);
  const personaOverlayManager = new PersonaOverlayManager(profileName);
  const teamsIndex = new TeamsIndex({
    dbPath: `./data/teams-index-${profileName}.sqlite`,
    retentionDays: profile?.retrieval?.teams?.retentionDays ?? 180,
    deltaLookbackHours: profile?.retrieval?.teams?.deltaLookbackHours ?? 6,
    deltaIntervalMs: profile?.retrieval?.teams?.deltaIntervalMs ?? 10 * 60 * 1000
  });
  teamsIndex.initialize();
  const entityGraph = new EntityGraph(`./data/entity-graph-${profileName}.sqlite`);
  entityGraph.initialize();

  const agentLoaderOptions = {
    profile,
    env: process.env,
    enabled: profile.agents?.enabled ?? []
  };
  const agents = await createDefaultAgents(agentLoaderOptions);
  const agentCatalog = await getAgentCatalog(agentLoaderOptions);

  const dispatcher = new Dispatcher({
    agents,
    memory,
    cache,
    modelGateway,
    graphClient: graphState.enabled ? graphState.client : undefined,
    teamsIndex,
    teamsRankingConfig: profile?.retrieval?.teams?.ranking ?? {},
    entityGraph,
    personaContext,
    narrativeMemory,
    patternCache,
    grammarStore,
    personaOverlayManager,
    cacheConfig: {
      enabled: profile.cache?.enabled !== false,
      grammarSystem: profile.cache?.grammarSystem ?? "completionBased"
    },
    composerConfig: {
      ...(profile.conversation?.composer ?? {}),
      budget: profile.conversation?.budget ?? {},
      quality: profile.conversation?.quality ?? {}
    }
  });

  return {
    profile,
    profilePath: filePath,
    envInfo,
    agentCatalog,
    dispatcher,
    modelGateway,
    memory,
    cache,
    patternCache,
    grammarStore,
    graphState,
    teamsIndex,
    entityGraph,
    personaContext,
    narrativeMemory,
    personaOverlayManager
  };
}

export async function runInteractive(profileName = "default") {
  const runtime = await buildRuntime(profileName);
  const {
    dispatcher,
    modelGateway,
    profile,
    envInfo,
    memory,
    cache,
    patternCache,
    grammarStore,
    graphState,
    teamsIndex,
    entityGraph,
    narrativeMemory
  } =
    runtime;
  let lastOutput = null;
  let pendingSuggestionId = null;
  let pendingClarification = null;
  let pendingRetry = null;
  let lastTeamsCoverage = null;
  const maxAutoApplyRisk = String(
    profile?.safety?.suggestionPolicy?.maxAutoApplyRisk ?? "low"
  ).toLowerCase();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `micro-claw(${profile.name})> `
  });

  function printHelp() {
    console.log(
      `Commands:\n` +
        `  /help\n` +
        `  /provider list|current|use <name>\n` +
        `  /model|status|list|current|use <name>\n` +
        `  /graph status|login|whoami|logout\n` +
        `  /teams status|probe\n` +
        `  /teams search <query> [window=today|48h|7d|30d|all] [surface=chats|channels|both] [depth=fast|balanced|deep|full] [top=1-100] [team=<name>] [channel=<name>] [sender=<name|email>] [since=<iso>] [until=<iso>] [importance=normal|high]\n` +
        `  /teams review [window=today|48h|7d|30d|all] [surface=chats|channels|both] [depth=fast|balanced|deep|full] [top=1-100]\n` +
        `  /sync teams|teams full|teams delta|status|config\n` +
        `  /evidence last\n` +
        `  /trace last\n` +
        `  /memory query <text>\n` +
        `  /memory stats\n` +
        `  /cache stats|clear|mode [completionBased|nfa]\n` +
        `  /review today|missed|followups\n` +
        `  /review client <name>\n` +
        `  /review project <name>\n` +
        `  /entity lookup <name>\n` +
        `  /entity recent\n` +
        `  /persona show|reload\n` +
        `  /composer status|test <prompt>\n` +
        `  /composer prompt [text]\n` +
        `  /router explain <text>\n` +
        `  /capabilities\n` +
        `  /suggest apply <id>\n` +
        `  /suggest explain <id>\n` +
        `  /suggest confirm <id>\n` +
        `  /memory summarize [today|week|session]\n` +
        `  /session refs\n` +
        `  /session info\n` +
        `  exit`
    );
  }

  console.log(
    `micro-claw running with profile=${profile.name}\n` +
      `profilePath=${runtime.profilePath}\n` +
      `envFile=${envInfo.filePath} exists=${envInfo.exists} loadedKeys=${envInfo.loaded.length}\n` +
      `provider=${modelGateway.getActiveProvider()} model=${modelGateway.getActiveModel()}\n` +
      `graph=${graphState.enabled ? "enabled" : `disabled (${graphState.reason})`}`
  );
  printHelp();
  rl.prompt();

  rl.on("line", async (line) => {
    let input = line.trim();
    if (input.startsWith("/models")) {
      input = input.replace(/^\/models\b/, "/model");
    }
    if (!input) return rl.prompt();
    if (input === "exit") return rl.close();
    if (input === "/help") {
      printHelp();
      return rl.prompt();
    }

    if (pendingSuggestionId && (input.toLowerCase() === "yes" || input.toLowerCase() === "y")) {
      const suggestion = findSuggestion(lastOutput, pendingSuggestionId);
      if (!suggestion) {
        console.log("Pending suggestion no longer available. Run the request again.");
        pendingSuggestionId = null;
        return rl.prompt();
      }
      const applied = await executeSuggestion({
        suggestion,
        dispatcher,
        memory,
        modelGateway,
        graphState,
        teamsIndex,
        entityGraph
      });
      if (applied.error) {
        console.log(applied.error);
        return rl.prompt();
      }
      pendingSuggestionId = null;
      lastOutput = applied.output;
      printOutput(applied.output);
      return rl.prompt();
    }

    if (pendingSuggestionId && (input.toLowerCase() === "no" || input.toLowerCase() === "n")) {
      console.log(`Cancelled pending suggestion '${pendingSuggestionId}'.`);
      pendingSuggestionId = null;
      return rl.prompt();
    }

    if (input === "/provider list") {
      const providers = ["ollama", "openai", "azure-openai", "anthropic"];
      const rows = await Promise.all(providers.map(async (p) => modelGateway.healthCheck(p)));
      console.log(JSON.stringify(rows, null, 2));
      return rl.prompt();
    }

    if (input === "/provider current") {
      const p = modelGateway.getActiveProvider();
      console.log(JSON.stringify({ provider: p, model: modelGateway.getActiveModel(p) }, null, 2));
      return rl.prompt();
    }

    if (input.startsWith("/provider use ")) {
      const provider = input.slice("/provider use ".length).trim();
      try {
        modelGateway.setActiveProvider(provider);
        console.log(JSON.stringify({ provider, model: modelGateway.getActiveModel(provider) }, null, 2));
      } catch (error) {
        console.log(`error: ${error.message}`);
      }
      return rl.prompt();
    }

    if (input === "/model current") {
      const p = modelGateway.getActiveProvider();
      console.log(JSON.stringify({ provider: p, model: modelGateway.getActiveModel(p) }, null, 2));
      return rl.prompt();
    }

    if (input === "/model" || input === "/model status") {
      const p = modelGateway.getActiveProvider();
      console.log(JSON.stringify({
        provider: p,
        model: modelGateway.getActiveModel(p),
        hint: "Use /model list or /model use <name>"
      }, null, 2));
      return rl.prompt();
    }

    if (input === "/model list") {
      try {
        const p = modelGateway.getActiveProvider();
        const models = await modelGateway.listModels(p);
        console.log(JSON.stringify({ provider: p, current: modelGateway.getActiveModel(p), models }, null, 2));
      } catch (error) {
        console.log(`error: ${error.message}`);
      }
      return rl.prompt();
    }

    if (input.startsWith("/model use ")) {
      const model = input.slice("/model use ".length).trim();
      const provider = modelGateway.getActiveProvider();

      if (provider === "ollama") {
        try {
          const models = await modelGateway.listModels(provider);
          if (!models.includes(model)) {
            console.log(JSON.stringify({
              switched: false,
              reason: "model-not-installed",
              requested: model,
              available: models
            }, null, 2));
            return rl.prompt();
          }
        } catch (error) {
          console.log(`error: ${error.message}`);
          return rl.prompt();
        }
      }

      modelGateway.setActiveModel(model, provider);
      if (typeof cache.clear === "function") cache.clear();
      console.log(JSON.stringify({ switched: true, provider, model }, null, 2));
      return rl.prompt();
    }

    if (input === "/graph status") {
      if (!graphState.enabled) {
        console.log(JSON.stringify({ enabled: false, reason: graphState.reason }, null, 2));
        return rl.prompt();
      }

      const cacheInfo = graphState.client.auth.loadCache();
      console.log(JSON.stringify({
        enabled: true,
        tenantId: graphState.client.auth.tenantId,
        scopes: graphState.client.auth.scopes,
        hasCachedToken: !!cacheInfo,
        expiresAt: cacheInfo?.expires_at ?? null
      }, null, 2));
      return rl.prompt();
    }

    if (input === "/graph login") {
      if (!graphState.enabled) {
        console.log(JSON.stringify({ enabled: false, reason: graphState.reason }, null, 2));
        return rl.prompt();
      }

      try {
        await graphState.client.login((prompt) => {
          console.log(prompt);
        });
        if (typeof cache.clear === "function") cache.clear();
        console.log("Graph login successful.");
        if (pendingRetry?.prompt) {
          console.log(`Pending retry available. Say 'retry' to run: ${pendingRetry.prompt}`);
        }
      } catch (error) {
        console.log(`Graph login failed: ${error.message}`);
      }
      return rl.prompt();
    }

    if (input === "/graph whoami") {
      if (!graphState.enabled) {
        console.log(JSON.stringify({ enabled: false, reason: graphState.reason }, null, 2));
        return rl.prompt();
      }

      try {
        const me = await graphState.client.getMe();
        console.log(JSON.stringify({
          displayName: me.displayName,
          userPrincipalName: me.userPrincipalName,
          mail: me.mail,
          id: me.id
        }, null, 2));
      } catch (error) {
        console.log(`Graph whoami failed: ${error.message}`);
      }
      return rl.prompt();
    }

    if (input === "/graph logout") {
      if (!graphState.enabled) {
        console.log(JSON.stringify({ enabled: false, reason: graphState.reason }, null, 2));
        return rl.prompt();
      }

      graphState.client.auth.clear();
      if (typeof cache.clear === "function") cache.clear();
      console.log("Graph token cache cleared.");
      return rl.prompt();
    }

    if (input === "/teams status") {
      const teamsLoaded = dispatcher.agents.some((a) => a.id === "ms.teams");
      const token = graphState.enabled ? graphState.client.auth.loadCache() : null;
      const scopes = graphState.enabled ? graphState.client.auth.scopes : [];
      const scopeSet = new Set(scopes.map((s) => String(s).toLowerCase()));
      const hasChatRead = scopeSet.has("chat.read");
      const tokenScopeSet = new Set(
        String(token?.scope ?? "")
          .split(/\s+/)
          .map((s) => s.toLowerCase().trim())
          .filter(Boolean)
      );
  const status = {
        graphEnabled: graphState.enabled,
        teamsAgentLoaded: teamsLoaded,
        requestedScopes: scopes,
        hasChatReadInRequestedScopes: hasChatRead,
        requestedChannelScopes: {
          teamReadBasicAll: scopeSet.has("team.readbasic.all"),
          channelMessageReadAll: scopeSet.has("channelmessage.read.all")
        },
        tokenCached: Boolean(token),
        tokenScope: token?.scope ?? null,
        tokenHasChatRead: tokenScopeSet.has("chat.read"),
        tokenHasTeamReadBasicAll: tokenScopeSet.has("team.readbasic.all"),
        tokenHasChannelMessageReadAll: tokenScopeSet.has("channelmessage.read.all"),
        ranking: profile?.retrieval?.teams?.ranking ?? {},
        tokenExpiresAt: token?.expires_at ?? null,
        probe: null,
        lastCoverage: lastTeamsCoverage
      };
      if (graphState.enabled && teamsLoaded) {
        try {
          const probe = await probeTeamsAccess(graphState.client);
          status.probe = {
            ok: true,
            probes: summarizeTeamsProbe(probe)
          };
        } catch (error) {
          status.probe = {
            ok: false,
            error: String(error.message ?? error)
          };
        }
      }
      console.log(JSON.stringify(status, null, 2));
      return rl.prompt();
    }

    if (input === "/teams probe") {
      if (!graphState.enabled) {
        console.log(JSON.stringify({ ok: false, reason: graphState.reason }, null, 2));
        return rl.prompt();
      }
      try {
        const probe = await probeTeamsAccess(graphState.client);
        console.log(JSON.stringify({
          ok: true,
          probes: summarizeTeamsProbe(probe),
          raw: probe
        }, null, 2));
      } catch (error) {
        console.log(JSON.stringify({ ok: false, error: String(error.message ?? error) }, null, 2));
      }
      return rl.prompt();
    }

    if (input === "/sync config") {
      console.log(JSON.stringify(teamsIndex.getConfig(), null, 2));
      return rl.prompt();
    }

    if (input === "/sync status") {
      console.log(JSON.stringify(teamsIndex.getStatus(), null, 2));
      return rl.prompt();
    }

    if (input === "/sync teams") {
      const synced = await teamsIndex.syncFromGraph(graphState.enabled ? graphState.client : undefined, {
        top: 100,
        surface: "both",
        depth: "deep",
        window: "all",
        mode: "full"
      });
      console.log(JSON.stringify(synced, null, 2));
      return rl.prompt();
    }

    if (input === "/sync teams full") {
      const synced = await teamsIndex.syncFromGraph(graphState.enabled ? graphState.client : undefined, {
        top: 2000,
        surface: "both",
        depth: "full",
        window: "all",
        mode: "full"
      });
      console.log(JSON.stringify(synced, null, 2));
      return rl.prompt();
    }

    if (input === "/sync teams delta") {
      const synced = await teamsIndex.syncFromGraph(graphState.enabled ? graphState.client : undefined, {
        top: 500,
        surface: "both",
        depth: "balanced",
        window: "all",
        mode: "delta",
        deltaLookbackHours: profile?.retrieval?.teams?.deltaLookbackHours ?? 6
      });
      console.log(JSON.stringify(synced, null, 2));
      return rl.prompt();
    }

    if (input.startsWith("/teams search ")) {
      const raw = input.slice("/teams search ".length).trim();
      const { text, args } = parseKeyValueArgs(raw);
      if (!text) {
        console.log(
          "Usage: /teams search <query> [window=...] [surface=...] [depth=...] [top=...] [team=...] [channel=...] [sender=...] [since=...] [until=...] [importance=normal|high]"
        );
        return rl.prompt();
      }
      const envelope = {
        requestId: crypto.randomUUID(),
        schemaVersion: getRegistryVersion(),
        agent: "ms.teams",
        action: "search_messages",
        params: {
          query: text,
          window: normalizeTeamsWindowArg(args.window, "30d"),
          surface: normalizeTeamsSurfaceArg(args.surface, "both"),
          depth: normalizeTeamsDepthArg(args.depth, "balanced"),
          top: normalizeTeamsTopArg(args.top, 30),
          team: normalizeTeamsScopeArg(args.team),
          channel: normalizeTeamsScopeArg(args.channel),
          sender: normalizeTeamsScopeArg(args.sender),
          since: String(args.since ?? "").trim(),
          until: String(args.until ?? "").trim(),
          importance: normalizeTeamsImportanceArg(args.importance)
        },
        confidence: 1,
        requiresConfirmation: false
      };
      const output = await executeDirectAction({
        input,
        envelope,
        dispatcher,
        memory,
        modelGateway,
        graphState,
        narrativeMemory,
        teamsIndex,
        entityGraph
      });
      lastOutput = output;
      lastTeamsCoverage = extractTeamsCoverage(output);
      printOutput(output);
      return rl.prompt();
    }

    if (input.startsWith("/teams review")) {
      const raw = input.slice("/teams review".length).trim();
      const { args } = parseKeyValueArgs(raw);
      const envelope = {
        requestId: crypto.randomUUID(),
        schemaVersion: getRegistryVersion(),
        agent: "ms.teams",
        action: "review_my_day",
        params: {
          window: normalizeTeamsWindowArg(args.window, "today"),
          surface: normalizeTeamsSurfaceArg(args.surface, "both"),
          depth: normalizeTeamsDepthArg(args.depth, "balanced"),
          top: normalizeTeamsTopArg(args.top, 30)
        },
        confidence: 1,
        requiresConfirmation: false
      };
      const output = await executeDirectAction({
        input,
        envelope,
        dispatcher,
        memory,
        modelGateway,
        graphState,
        narrativeMemory,
        teamsIndex,
        entityGraph
      });
      lastOutput = output;
      lastTeamsCoverage = extractTeamsCoverage(output);
      printOutput(output);
      return rl.prompt();
    }

    if (input.startsWith("/memory query ")) {
      const query = input.slice("/memory query ".length).trim();
      console.log(JSON.stringify(memory.query(query, { topK: 5 }), null, 2));
      return rl.prompt();
    }

    if (input === "/memory stats") {
      const stats = typeof memory.stats === "function" ? memory.stats() : { backend: "unknown" };
      console.log(JSON.stringify(stats, null, 2));
      return rl.prompt();
    }

    if (input === "/evidence last") {
      console.log(JSON.stringify(lastOutput?.evidence ?? [], null, 2));
      return rl.prompt();
    }

    if (input === "/trace last") {
      console.log(JSON.stringify(lastOutput?.trace ?? null, null, 2));
      return rl.prompt();
    }

    if (input === "/session refs") {
      console.log(JSON.stringify(dispatcher.sessionRefs ?? {}, null, 2));
      return rl.prompt();
    }

    if (input === "/entity recent") {
      console.log(JSON.stringify(entityGraph.recent(12), null, 2));
      return rl.prompt();
    }

    if (input.startsWith("/entity lookup ")) {
      const query = input.slice("/entity lookup ".length).trim();
      if (!query) {
        console.log("Usage: /entity lookup <name>");
        return rl.prompt();
      }
      console.log(JSON.stringify(entityGraph.lookup(query), null, 2));
      return rl.prompt();
    }

    if (input.startsWith("/memory summarize")) {
      const range = input.split(/\s+/)[2] ?? "today";
      console.log(JSON.stringify({
        range,
        entries: narrativeMemory.summarize(range, 12)
      }, null, 2));
      return rl.prompt();
    }

    if (input === "/cache stats" || input === "/cache status") {
      console.log(
        JSON.stringify(
          {
            mode: dispatcher.cacheConfig?.grammarSystem ?? "completionBased",
            translationCache: cache.stats(),
            patternCache: patternCache.stats ? patternCache.stats() : null,
            grammarStore: grammarStore.stats ? grammarStore.stats() : null
          },
          null,
          2
        )
      );
      return rl.prompt();
    }

    if (input === "/cache clear") {
      if (typeof cache.clear === "function") cache.clear();
      if (typeof patternCache.clear === "function") patternCache.clear();
      if (typeof grammarStore.clear === "function") grammarStore.clear();
      console.log("cache cleared");
      return rl.prompt();
    }

    if (input.startsWith("/cache mode")) {
      const mode = input.split(/\s+/)[2];
      if (!mode) {
        console.log(JSON.stringify({ mode: dispatcher.cacheConfig?.grammarSystem ?? "completionBased" }, null, 2));
        return rl.prompt();
      }
      if (!["completionBased", "nfa"].includes(mode)) {
        console.log("Usage: /cache mode [completionBased|nfa]");
        return rl.prompt();
      }
      dispatcher.cacheConfig = {
        ...(dispatcher.cacheConfig ?? {}),
        grammarSystem: mode
      };
      console.log(JSON.stringify({ mode, switched: true }, null, 2));
      return rl.prompt();
    }

    if (input === "/session info") {
      console.log(JSON.stringify({
        profile: profile.name,
        provider: modelGateway.getActiveProvider(),
        model: modelGateway.getActiveModel(),
        memoryBackend: memory.stats ? memory.stats().backend : "inmemory",
        graphEnabled: graphState.enabled,
        agentsLoaded: dispatcher.agents.map((a) => a.id),
        narrativeEntries: narrativeMemory.stats().entries,
        cacheMode: dispatcher.cacheConfig?.grammarSystem ?? "completionBased",
        patternCache: patternCache.stats ? patternCache.stats() : null,
        grammarStore: grammarStore.stats ? grammarStore.stats() : null,
        teamsIndex: teamsIndex.getStatus(),
        composer: dispatcher.composerConfig ?? {}
      }, null, 2));
      return rl.prompt();
    }

    if (input === "/composer status") {
      console.log(JSON.stringify({
        enabled: dispatcher.composerConfig?.enabled !== false,
        strategy: dispatcher.composerConfig?.strategy ?? "hybrid_fallback",
        primary: dispatcher.composerConfig?.primary ?? null,
        fallback: dispatcher.composerConfig?.fallback ?? null,
        budget: dispatcher.composerConfig?.budget ?? {},
        quality: dispatcher.composerConfig?.quality ?? {}
      }, null, 2));
      return rl.prompt();
    }

    if (input.startsWith("/composer prompt")) {
      const prompt = input.slice("/composer prompt".length).trim() || "hello";
      console.log(JSON.stringify(dispatcher.previewComposerPrompt(prompt), null, 2));
      return rl.prompt();
    }

    if (input.startsWith("/composer test ")) {
      const prompt = input.slice("/composer test ".length).trim();
      if (!prompt) {
        console.log("Usage: /composer test <prompt>");
        return rl.prompt();
      }
      const out = await dispatcher.route(prompt);
      lastOutput = out;
      printOutput(out);
      if (out?.composer) {
        console.log("");
        console.log(
          `Composer: source=${out.composer.source} provider=${out.composer.provider} model=${out.composer.model}`
        );
      }
      return rl.prompt();
    }

    if (input.startsWith("/router explain ")) {
      const text = input.slice("/router explain ".length).trim();
      if (!text) {
        console.log("Usage: /router explain <text>");
        return rl.prompt();
      }
      console.log(JSON.stringify(dispatcher.explainRoute(text), null, 2));
      return rl.prompt();
    }

    if (input === "/capabilities") {
      console.log(JSON.stringify({
        capabilityPack: dispatcher.getCapabilities(),
        agentCatalog: runtime.agentCatalog
      }, null, 2));
      return rl.prompt();
    }

    if (input.startsWith("/review ")) {
      const target = input.slice("/review ".length).trim();
      if (target.startsWith("client ")) {
        const name = target.slice("client ".length).trim();
        if (!name) {
          console.log("Usage: /review client <name>");
          return rl.prompt();
        }
        const output = await runReviewOrchestrator({
          target: "today",
          dispatcher,
          entityGraph,
          focus: { kind: "client", name }
        });
        dispatcher.sessionRefs = updateSessionRefsFromReview(dispatcher.sessionRefs, {
          target: `client:${name}`,
          triageItems: output?.artifacts?.triageItems ?? []
        });
        lastOutput = output;
        printOutput(output);
        return rl.prompt();
      }
      if (target.startsWith("project ")) {
        const name = target.slice("project ".length).trim();
        if (!name) {
          console.log("Usage: /review project <name>");
          return rl.prompt();
        }
        const output = await runReviewOrchestrator({
          target: "today",
          dispatcher,
          entityGraph,
          focus: { kind: "project", name }
        });
        dispatcher.sessionRefs = updateSessionRefsFromReview(dispatcher.sessionRefs, {
          target: `project:${name}`,
          triageItems: output?.artifacts?.triageItems ?? []
        });
        lastOutput = output;
        printOutput(output);
        return rl.prompt();
      }
      if (!["today", "missed", "followups"].includes(target)) {
        console.log("Usage: /review today|missed|followups|client <name>|project <name>");
        return rl.prompt();
      }
      const output = await runReviewOrchestrator({
        target,
        dispatcher,
        entityGraph
      });
      dispatcher.sessionRefs = updateSessionRefsFromReview(dispatcher.sessionRefs, {
        target,
        triageItems: output?.artifacts?.triageItems ?? []
      });
      lastOutput = output;
      printOutput(output);
      return rl.prompt();
    }

    if (input === "/persona show") {
      console.log(JSON.stringify(dispatcher.personaContext ?? {}, null, 2));
      return rl.prompt();
    }

    if (input === "/persona reload") {
      runtime.personaContext = loadPersonaContext(profile.name);
      dispatcher.personaContext = runtime.personaContext;
      console.log("persona reloaded");
      return rl.prompt();
    }

    if (input.startsWith("/suggest apply ")) {
      const id = input.slice("/suggest apply ".length).trim();
      const suggestion = findSuggestion(lastOutput, id);
      if (!suggestion) {
        console.log("Suggestion not found. Run a request that returns suggestions first.");
        return rl.prompt();
      }
      if (!isRiskAtMost(suggestion.risk, maxAutoApplyRisk)) {
        pendingSuggestionId = id;
        console.log(
          `Suggestion '${id}' has risk=${suggestion.risk}. Use '/suggest explain ${id}' to inspect intent/evidence, then '/suggest confirm ${id}' to execute.`
        );
        return rl.prompt();
      }
      const applied = await executeSuggestion({
        suggestion,
        dispatcher,
        memory,
        modelGateway,
        graphState,
        teamsIndex,
        entityGraph
      });
      if (applied.error) {
        console.log(applied.error);
        return rl.prompt();
      }
      pendingSuggestionId = null;
      lastOutput = applied.output;
      printOutput(applied.output);
      return rl.prompt();
    }

    if (input.startsWith("/suggest explain ")) {
      const id = input.slice("/suggest explain ".length).trim();
      const suggestion = findSuggestion(lastOutput, id);
      if (!suggestion) {
        console.log("Suggestion not found. Run a request that returns suggestions first.");
        return rl.prompt();
      }
      printSuggestionDetails(suggestion);
      return rl.prompt();
    }

    if (input.startsWith("/suggest confirm ")) {
      const id = input.slice("/suggest confirm ".length).trim();
      const suggestion = findSuggestion(lastOutput, id);
      if (!suggestion) {
        console.log("Suggestion not found. Run a request that returns suggestions first.");
        return rl.prompt();
      }
      if (pendingSuggestionId && pendingSuggestionId !== id) {
        console.log(`Pending suggestion '${pendingSuggestionId}' exists. Confirm that one first or run a new request.`);
        return rl.prompt();
      }
      const applied = await executeSuggestion({
        suggestion,
        dispatcher,
        memory,
        modelGateway,
        graphState,
        teamsIndex,
        entityGraph
      });
      if (applied.error) {
        console.log(applied.error);
        return rl.prompt();
      }
      pendingSuggestionId = null;
      lastOutput = applied.output;
      printOutput(applied.output);
      return rl.prompt();
    }

    if (input.startsWith("/")) {
      console.log(`Unknown command '${input}'. Use /help.`);
      return rl.prompt();
    }

    if (input.startsWith("model ")) {
      console.log("Use slash commands for model control, e.g. '/model use <name>' or '/model list'.");
      return rl.prompt();
    }

    if (!input.startsWith("/") && pendingClarification && isDomainResolutionReply(input, pendingClarification)) {
      input = `for ${input.toLowerCase()}: ${pendingClarification.originalInput}`;
      pendingClarification = null;
    }

    if (!input.startsWith("/") && pendingRetry?.prompt && isRetryReply(input)) {
      input = pendingRetry.prompt;
      pendingRetry = null;
    }

    const matchedSuggestion = matchSuggestionInput(lastOutput, input);
    if (matchedSuggestion) {
      if (isRiskAtMost(matchedSuggestion.risk, maxAutoApplyRisk)) {
        const applied = await executeSuggestion({
          suggestion: matchedSuggestion,
          dispatcher,
          memory,
          modelGateway,
          graphState,
          teamsIndex,
          entityGraph
        });
        if (applied.error) {
          console.log(applied.error);
          return rl.prompt();
        }
        lastOutput = applied.output;
        printOutput(applied.output);
        return rl.prompt();
      }
      pendingSuggestionId = matchedSuggestion.id;
      console.log(
        `That matches suggestion '${matchedSuggestion.id}' (risk=${matchedSuggestion.risk}). Reply 'yes' to execute or run '/suggest explain ${matchedSuggestion.id}'.`
      );
      return rl.prompt();
    }

    const output = await dispatcher.route(input);
    pendingRetry = shouldOfferRetry(output, input)
      ? { prompt: input, reason: "graph_not_authenticated" }
      : pendingRetry;
    if (output?.status === "ok" && pendingRetry?.prompt === input) {
      pendingRetry = null;
    }
    pendingClarification =
      output?.status === "clarify"
        ? {
            originalInput: input,
            options: output?.artifacts?.clarification?.options ?? []
          }
        : null;
    lastOutput = output;
    lastTeamsCoverage = extractTeamsCoverage(output);
    printOutput(output);
    rl.prompt();
  });

  rl.on("close", () => {
    if (runtime._teamsSyncTimer) clearInterval(runtime._teamsSyncTimer);
    console.log("bye");
    process.exit(0);
  });

  const scheduleMs = Number(profile?.retrieval?.teams?.deltaIntervalMs ?? teamsIndex.getConfig().syncIntervalMs);
  if (graphState.enabled && Number.isFinite(scheduleMs) && scheduleMs > 0) {
    runtime._teamsSyncTimer = setInterval(async () => {
      try {
        await teamsIndex.syncFromGraph(graphState.client, {
          top: 500,
          surface: "both",
          depth: "balanced",
          window: "all",
          mode: "delta",
          deltaLookbackHours: profile?.retrieval?.teams?.deltaLookbackHours ?? 6
        });
      } catch {
        // best effort background sync
      }
    }, scheduleMs);
  }
}

function printOutput(output) {
  if (output?.finalText) {
    console.log(output.finalText);
    const isChat = output?.conversationMode === "chat";
    if (!isChat && Array.isArray(output.evidence) && output.evidence.length > 0) {
      console.log("");
      console.log("Evidence:");
      for (const ev of output.evidence.slice(0, 4)) {
        console.log(`- [${ev.id}] ${ev.label} (${ev.source})`);
        const details = summarizeEvidenceDetails(ev.details);
        if (details) console.log(`  details: ${details}`);
      }
    }
    if (!isChat && Array.isArray(output.suggestedActions) && output.suggestedActions.length > 0) {
      console.log("");
      console.log("Suggestions:");
      for (const suggestion of output.suggestedActions) {
        console.log(`- [${suggestion.id}] ${suggestion.title} (risk=${suggestion.risk})`);
        if (suggestion.rationale) console.log(`  why: ${suggestion.rationale}`);
        const evidence = Array.isArray(suggestion.evidence) ? suggestion.evidence.slice(0, 2) : [];
        for (const row of evidence) {
          console.log(`  from: ${JSON.stringify(row)}`);
        }
      }
    }
    return;
  }
  console.log(JSON.stringify(output, null, 2));
}

function extractTeamsCoverage(output) {
  const action = output?.artifacts?.action;
  const result = output?.artifacts?.result;
  if (action?.agent !== "ms.teams") return null;
  return {
    action: action.action,
    params: result?.params ?? {},
    coverage: result?.coverage ?? null,
    limitations: result?.limitations ?? [],
    timestamp: new Date().toISOString()
  };
}

function summarizeTeamsProbe(probe) {
  const out = {};
  for (const [key, value] of Object.entries(probe ?? {})) {
    if (!value || typeof value !== "object") {
      out[key] = value;
      continue;
    }
    out[key] = {
      ok: Boolean(value.ok),
      endpoint: value.endpoint ?? null,
      count: value.count ?? null,
      skipped: Boolean(value.skipped),
      empty: Boolean(value.empty),
      error: value.error ?? null,
      reason: value.reason ?? null
    };
  }
  return out;
}

function findSuggestion(lastOutput, id) {
  const items = lastOutput?.suggestedActions ?? [];
  return items.find((s) => s.id === id || `${s.id}` === id);
}

function matchSuggestionInput(lastOutput, input) {
  const items = lastOutput?.suggestedActions ?? [];
  if (!Array.isArray(items) || items.length === 0) return null;
  const norm = normalizeSuggestionText(input);
  if (!norm) return null;
  for (const item of items) {
    const id = normalizeSuggestionText(item.id);
    const title = normalizeSuggestionText(item.title);
    if (norm === id || norm === title) return item;
  }
  return null;
}

async function executeSuggestion({ suggestion, dispatcher, memory, modelGateway, graphState, teamsIndex, entityGraph }) {
  const envelope = {
    requestId: crypto.randomUUID(),
    schemaVersion: getRegistryVersion(),
    agent: suggestion.actionEnvelope.agent,
    action: suggestion.actionEnvelope.action,
    params: suggestion.actionEnvelope.params ?? {},
    confidence: 1,
    requiresConfirmation: suggestion.risk !== "low"
  };
  const valid = validateActionEnvelope(envelope);
  if (!valid.ok) return { error: `Cannot apply suggestion: ${valid.errors.join(", ")}` };
  const agent = dispatcher.agents.find((a) => a.id === envelope.agent);
  if (!agent) return { error: `No agent available for ${envelope.agent}` };

  const result = await agent.execute(envelope, {
    memory,
    modelGateway,
    graphClient: graphState.enabled ? graphState.client : undefined,
    teamsIndex,
    teamsRankingConfig: dispatcher.teamsRankingConfig ?? {},
    entityGraph
  });
  dispatcher.sessionRefs = updateSessionRefsFromExecution(dispatcher.sessionRefs, envelope, result);
  entityGraph?.observeExecution(envelope, result.artifacts ?? {});
  return {
    output: {
      requestId: envelope.requestId,
      status: result.status,
      message: result.message,
      artifacts: {
        action: envelope,
        translationSource: "suggestion",
        result: result.artifacts ?? {}
      },
      finalText: `Applied suggestion ${suggestion.id}: ${result.message}`,
      suggestedActions: [],
      trace: dispatcher.buildTrace({
        traceId: crypto.randomUUID(),
        requestId: envelope.requestId,
        agent: envelope.agent,
        cacheHit: false,
        translationSource: "suggestion",
        stageTimingsMs: {},
        validationErrors: [],
        executionError: result.status === "error" ? result.message : null
      })
    }
  };
}

function riskValue(risk) {
  const r = String(risk ?? "medium").toLowerCase();
  if (r === "low") return 1;
  if (r === "medium") return 2;
  return 3;
}

function isRiskAtMost(risk, maxRisk) {
  return riskValue(risk) <= riskValue(maxRisk);
}

function printSuggestionDetails(suggestion) {
  const envelope = suggestion.actionEnvelope ?? {};
  console.log(`Suggestion [${suggestion.id}]`);
  console.log(`title: ${suggestion.title}`);
  console.log(`risk: ${suggestion.risk}`);
  if (suggestion.rationale) console.log(`why: ${suggestion.rationale}`);
  console.log(`intent: ${envelope.agent}.${envelope.action}`);
  console.log(`params: ${JSON.stringify(envelope.params ?? {}, null, 2)}`);
  const evidence = Array.isArray(suggestion.evidence) ? suggestion.evidence : [];
  if (evidence.length > 0) {
    console.log("evidence:");
    for (const row of evidence.slice(0, 5)) {
      console.log(`- ${JSON.stringify(row)}`);
    }
  }
}

function summarizeEvidenceDetails(details) {
  if (!details || typeof details !== "object") return "";
  const keys = Object.keys(details);
  if (keys.length === 0) return "";
  const sample = {};
  for (const key of keys.slice(0, 5)) sample[key] = details[key];
  return JSON.stringify(sample);
}

function normalizeSuggestionText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isRetryReply(input) {
  const lower = String(input ?? "").trim().toLowerCase();
  return [
    "retry",
    "try again",
    "run again",
    "yes",
    "yep",
    "yeah",
    "go ahead",
    "please retry"
  ].includes(lower);
}

function shouldOfferRetry(output, input) {
  if (!output || output.status !== "error") return false;
  const msg = String(output.message ?? "").toLowerCase();
  const hasAction = Boolean(output.artifacts?.action);
  if (!hasAction) return false;
  if (!msg.includes("graph not authenticated")) return false;
  return Boolean(String(input ?? "").trim());
}

function isDomainResolutionReply(input, pendingClarification) {
  const value = String(input ?? "").toLowerCase().trim();
  if (!value) return false;
  const known = ["outlook", "calendar", "teams", "sharepoint", "onedrive"];
  if (known.includes(value)) return true;
  const options = Array.isArray(pendingClarification?.options)
    ? pendingClarification.options.map((o) => String(o).toLowerCase())
    : [];
  return options.includes(value);
}

function parseKeyValueArgs(input) {
  const args = {};
  const parts = String(input ?? "").split(/\s+/).filter(Boolean);
  const free = [];
  for (const part of parts) {
    const m = part.match(/^([a-zA-Z_]+)=(.+)$/);
    if (!m) {
      free.push(part);
      continue;
    }
    args[m[1].toLowerCase()] = m[2];
  }
  return { text: free.join(" ").trim(), args };
}

function normalizeTeamsWindowArg(value, fallback) {
  const v = String(value ?? fallback).toLowerCase();
  if (["today", "48h", "7d", "30d", "all"].includes(v)) return v;
  return fallback;
}

function normalizeTeamsSurfaceArg(value, fallback) {
  const v = String(value ?? fallback).toLowerCase();
  if (["chats", "channels", "both"].includes(v)) return v;
  return fallback;
}

function normalizeTeamsDepthArg(value, fallback) {
  const v = String(value ?? fallback).toLowerCase();
  if (["fast", "balanced", "deep", "full"].includes(v)) return v;
  return fallback;
}

function normalizeTeamsTopArg(value, fallback) {
  const n = Number(value ?? fallback);
  if (Number.isNaN(n) || n < 1) return fallback;
  return Math.min(100, Math.floor(n));
}

function formatTeamsScopeDirective(key, value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return `${key}=${text.replace(/\s+/g, "_")} `;
}

function normalizeTeamsScopeArg(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.replace(/^['"]|['"]$/g, "").replace(/_/g, " ").trim();
}

function normalizeTeamsImportanceArg(value) {
  const v = String(value ?? "").toLowerCase().trim();
  if (v === "high" || v === "normal") return v;
  return "";
}

async function executeDirectAction({
  input,
  envelope,
  dispatcher,
  memory,
  modelGateway,
  graphState,
  narrativeMemory,
  teamsIndex,
  entityGraph
}) {
  if (typeof memory?.addTurn === "function") {
    memory.addTurn({ role: "user", text: input, source: "cli" });
  }

  const valid = validateActionEnvelope(envelope);
  if (!valid.ok) {
    return {
      requestId: envelope.requestId,
      status: "error",
      message: `Invalid action: ${valid.errors.join(", ")}`,
      artifacts: { action: envelope, translationSource: "slash", result: {} },
      suggestedActions: []
    };
  }

  const agent = dispatcher.agents.find((a) => a.id === envelope.agent);
  if (!agent) {
    return {
      requestId: envelope.requestId,
      status: "error",
      message: `No agent available for ${envelope.agent}`,
      artifacts: { action: envelope, translationSource: "slash", result: {} },
      suggestedActions: []
    };
  }

  const execution = await agent.execute(envelope, {
    memory,
    modelGateway,
    graphClient: graphState.enabled ? graphState.client : undefined,
    teamsIndex,
    teamsRankingConfig: dispatcher.teamsRankingConfig ?? {},
    entityGraph
  });
  dispatcher.sessionRefs = updateSessionRefsFromExecution(dispatcher.sessionRefs, envelope, execution);
  entityGraph?.observeExecution(envelope, execution.artifacts ?? {});

  const composed = await composeResponse({
    input,
    actionEnvelope: envelope,
    executionResult: execution,
    memoryRefs: [],
    personaContext: dispatcher.personaContext,
    capabilityPack: dispatcher.getCapabilities(),
    modelGateway,
    composerConfig: dispatcher.composerConfig ?? {},
    memoryEvidence: [],
    narrativeEntries: typeof narrativeMemory?.summarize === "function" ? narrativeMemory.summarize("session", 5) : []
  });

  if (typeof memory?.addTurn === "function") {
    memory.addTurn({
      role: "assistant",
      text: composed.finalText ?? execution.message,
      source: envelope.agent
    });
  }

  return {
    requestId: envelope.requestId,
    status: execution.status,
    message: execution.message,
    artifacts: {
      action: envelope,
      translationSource: "slash",
      result: execution.artifacts ?? {}
    },
    finalText: composed.finalText,
    conversation: composed.conversation,
    conversationMode: composed.conversationMode,
    evidence: composed.evidence ?? [],
    suggestedActions: composed.suggestedActions ?? [],
    memoryRefs: composed.memoryRefs ?? [],
    composer: composed.composer,
    sessionRefs: { ...dispatcher.sessionRefs },
    trace: dispatcher.buildTrace({
      traceId: crypto.randomUUID(),
      requestId: envelope.requestId,
      agent: envelope.agent,
      cacheHit: false,
      translationSource: "slash",
      stageTimingsMs: {},
      validationErrors: [],
      executionError: execution.status === "error" ? execution.message : null
    })
  };
}
