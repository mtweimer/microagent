import type {
  ActionEnvelope,
  AgentExecutionResult,
  AnyRecord,
  EntityGraphLike,
  NarrativeMemoryLike,
  RetrievalResult,
  RouteDecision,
  SessionRefs,
  TeamsIndexLike,
  MemoryStore,
  TranslationCache
} from "../../contracts.js";
import { RetrievalPlanner } from "../planner/RetrievalPlanner.js";
import { GathererRegistry } from "../registry/GathererRegistry.js";
import { SessionRefsGatherer } from "../gatherers/SessionRefsGatherer.js";
import { StructuredMemoryGatherer } from "../gatherers/StructuredMemoryGatherer.js";
import { NarrativeMemoryGatherer } from "../gatherers/NarrativeMemoryGatherer.js";
import { TeamsIndexGatherer } from "../gatherers/TeamsIndexGatherer.js";
import { EntityGraphGatherer } from "../gatherers/EntityGraphGatherer.js";
import { CacheGatherer } from "../gatherers/CacheGatherer.js";
import { Ranker } from "../ranking/Ranker.js";
import { DiversityPolicy } from "../ranking/DiversityPolicy.js";
import { ContextPacker } from "../packing/ContextPacker.js";
import type { Gatherer } from "../gatherers/Gatherer.js";

interface RetrievalEngineInput {
  input: string;
  routeDecision?: RouteDecision | null;
  envelope?: ActionEnvelope | null;
  executionResult?: AgentExecutionResult | null;
  excludeMemoryIds?: Array<string | number>;
}

interface RetrievalEngineDeps {
  memory: MemoryStore;
  cache: TranslationCache;
  getCacheKey?: ((input: string) => string) | null;
  sessionRefs: SessionRefs;
  entityGraph?: EntityGraphLike | null;
  teamsIndex?: TeamsIndexLike | null;
  narrativeMemory?: NarrativeMemoryLike | null;
  retrievalConfig?: AnyRecord;
}

export class RetrievalEngine {
  planner: RetrievalPlanner;
  registry: GathererRegistry;
  ranker: Ranker;
  diversityPolicy: DiversityPolicy;
  packer: ContextPacker;
  deps: RetrievalEngineDeps;

  constructor(deps: RetrievalEngineDeps) {
    this.deps = deps;
    this.planner = new RetrievalPlanner();
    this.registry = new GathererRegistry(this.createGatherers());
    this.ranker = new Ranker();
    this.diversityPolicy = new DiversityPolicy();
    this.packer = new ContextPacker();
  }

  createGatherers(excludeMemoryIds: Array<string | number> = [], input = ""): Gatherer[] {
    const gatherers: Gatherer[] = [
      new SessionRefsGatherer(this.deps.sessionRefs),
      new StructuredMemoryGatherer(this.deps.memory, excludeMemoryIds),
      new CacheGatherer(this.deps.cache, this.deps.getCacheKey?.(input) ?? input)
    ];
    if (this.deps.narrativeMemory) gatherers.push(new NarrativeMemoryGatherer(this.deps.narrativeMemory));
    if (this.deps.teamsIndex) gatherers.push(new TeamsIndexGatherer(this.deps.teamsIndex));
    if (this.deps.entityGraph) gatherers.push(new EntityGraphGatherer(this.deps.entityGraph));
    return gatherers;
  }

  async retrieve({ input, routeDecision, envelope, executionResult, excludeMemoryIds = [] }: RetrievalEngineInput): Promise<RetrievalResult> {
    this.registry = new GathererRegistry(this.createGatherers(excludeMemoryIds, input));
    const plan = this.planner.plan({
      input,
      ...(routeDecision !== undefined ? { routeDecision } : {}),
      ...(envelope !== undefined ? { envelope } : {}),
      ...(executionResult !== undefined ? { executionResult } : {}),
      sessionRefs: this.deps.sessionRefs,
      entityGraph: this.deps.entityGraph ?? null,
      retrievalConfig: this.deps.retrievalConfig ?? {}
    });
    const { evidence, latencyMsByGatherer } = await this.registry.gatherAll(plan);
    const { ranked, scoreBreakdownById } = this.ranker.rank(plan, evidence);
    const diverse = this.diversityPolicy.apply(plan, ranked);
    const countsBySource = diverse.reduce<Record<string, number>>((acc, row) => {
      acc[row.sourceType] = (acc[row.sourceType] ?? 0) + 1;
      return acc;
    }, {});
    return this.packer.pack(plan, diverse, {
      gatherers: this.registry.supported(plan).map((gatherer) => gatherer.name),
      latencyMsByGatherer,
      countsBySource,
      scoreBreakdownById
    });
  }
}
