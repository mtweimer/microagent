import type { PersonaContext } from "./personaContext.js";

export type AnyRecord = Record<string, unknown>;

export type JsonTypeName = "string" | "number" | "boolean" | "array" | "object";
export type RiskLevel = "low" | "medium" | "high";
export type ExecutionStatus = "ok" | "error" | "clarify" | "unsupported";
export type ConversationMode = "chat" | "action_result" | "clarify" | "review";
export type RouteMode = "action" | "retrieval" | "chat" | "clarify" | "unsupported";

export interface ActionInputSchema {
  required: readonly string[];
  properties: Readonly<Record<string, JsonTypeName>>;
}

export interface ActionExecutorCapabilities {
  dryRun: boolean;
  requiresConfirmation: boolean;
}

export interface ActionConfig {
  schemaVersion: string;
  inputSchema: ActionInputSchema;
  translatorHints: string;
  executorCapabilities: ActionExecutorCapabilities;
}

export interface DomainConfig {
  agentId: string;
  requiredScopes: readonly string[];
  actions: Readonly<Record<string, ActionConfig>>;
}

export interface DomainRank {
  domain: string;
  score: number;
}

export interface ActionEnvelope {
  requestId: string;
  schemaVersion: string;
  agent: string;
  action: string;
  params: AnyRecord;
  confidence?: number;
  requiresConfirmation?: boolean;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export interface TraceRecord {
  traceId: string;
  requestId: string;
  provider: string;
  model: string;
  translationSource: string;
  schemaVersion: string;
  agent: string;
  cacheHit: boolean;
  stageTimingsMs: Record<string, number>;
  validationErrors: string[];
  executionError: string | null;
  timestamp: string;
}

export interface MemoryTurn {
  role: "user" | "assistant";
  text: string;
  source: string;
}

export interface MemoryQueryHit extends AnyRecord {
  id: string | number;
}

export interface MemoryQueryResult {
  results: MemoryQueryHit[];
}

export interface AgentExecutionContext {
  memory: MemoryStore;
  modelGateway: ModelGatewayLike | null;
  graphClient: GraphClientLike | null;
  teamsIndex?: TeamsIndexLike | null;
  teamsRankingConfig?: AnyRecord;
  entityGraph?: EntityGraphLike | null;
}

export interface AgentExecutionResult {
  status: ExecutionStatus;
  message: string;
  artifacts?: AnyRecord;
}

export interface AgentLike {
  id: string;
  description?: string | null;
  execute(envelope: ActionEnvelope, context: AgentExecutionContext): Promise<AgentExecutionResult>;
}

export interface TranslationResult {
  envelope: ActionEnvelope;
  source: string;
  validationErrors: string[];
}

export interface DomainSelection {
  primary: string | null;
  candidates: DomainRank[];
  ambiguous: boolean;
}

export interface RouteDecision {
  mode: RouteMode;
  domain: string | null;
  actionHint: string | null;
  confidence: number;
  needsClarification: boolean;
  clarificationQuestion: string | null;
  unsupportedReason: string | null;
}

export interface ComposerMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface EvidenceItem {
  id: string;
  type: string;
  source: string;
  label: string;
  details: AnyRecord;
}

export interface SuggestedAction {
  id: string;
  title: string;
  rationale: string;
  risk: RiskLevel;
  safe?: boolean;
  evidence?: unknown[];
  evidenceRefs?: string[];
  actionEnvelope: {
    agent: string;
    action: string;
    params: AnyRecord;
  };
}

export interface ConversationBlock {
  summary: string;
  intent: string;
  reasoning: string;
  confidence: number;
  followUpQuestion: string | null;
}

export interface ComposerResult {
  finalText: string;
  conversation: ConversationBlock;
  evidence: EvidenceItem[];
  suggestedActions: SuggestedAction[];
  conversationMode: ConversationMode;
  memoryRefs: Array<string | number>;
  composer: AnyRecord;
}

export interface DispatcherArtifacts extends AnyRecord {
  action?: ActionEnvelope;
  result?: AnyRecord;
}

export interface DispatcherResponse {
  requestId: string;
  status: ExecutionStatus | "unsupported";
  message: string;
  finalText?: string;
  artifacts: DispatcherArtifacts;
  memoryRefs: Array<string | number>;
  trace: TraceRecord;
  evidence?: EvidenceItem[];
  suggestedActions?: SuggestedAction[];
  conversation?: ConversationBlock;
  conversationMode?: ConversationMode;
  composer?: AnyRecord;
  router?: RouteDecision;
  capabilityGrounded?: boolean;
  retrievalPlan?: AnyRecord | null;
  sessionRefs?: SessionRefs;
}

export interface OutlookSessionRefs {
  lastEmailId: string | null;
  lastEmailIds: string[];
}

export interface CalendarSessionRefs {
  lastEventSubject: string | null;
  lastEventLink: string | null;
  lastTimeRange: string | null;
}

export interface TeamsSessionRefs {
  lastThreadId: string | null;
  lastMessageIds: string[];
  lastTeam: string | null;
  lastChannel: string | null;
}

export interface ReviewFocus {
  kind: "client" | "project";
  name: string;
}

export interface TriageItem {
  id: string;
  title: string;
  sourceDomain: string;
  sourceArtifactId: string;
  triageClass: string;
  priority: RiskLevel;
  rationale: string;
  evidence: unknown[];
}

export interface ReviewSessionRefs {
  lastTarget: string | null;
  lastItems: TriageItem[];
}

export interface EntitySessionRefs {
  lastNames: string[];
}

export interface SessionRefs {
  outlook: OutlookSessionRefs;
  calendar: CalendarSessionRefs;
  teams: TeamsSessionRefs;
  review: ReviewSessionRefs;
  entities: EntitySessionRefs;
}

export interface FollowupResolution {
  source: string;
  envelope: ActionEnvelope;
}

export interface CapabilityPack {
  supportedDomains: string[];
  supportedActions: Record<string, string[]>;
  unsupportedKeywords: string[];
  policy: string;
}

export interface ModelGatewayLike {
  getActiveProvider?(): string;
  getActiveModel?(provider?: string): string;
  completeJson(messages: ComposerMessage[], options?: AnyRecord): Promise<unknown>;
  completeText(messages: ComposerMessage[], options?: AnyRecord): Promise<string>;
}

export interface GraphClientLike {
  get?(path: string): Promise<unknown>;
  post?(path: string, body: unknown): Promise<unknown>;
}

export interface TeamsIndexLike {
  searchMessages?(options?: AnyRecord): unknown;
  getMessageById?(id: string): unknown;
}

export interface EntityGraphLike {
  observeExecution?(envelope: ActionEnvelope, artifacts: AnyRecord): void;
  aliasesFor?(name: string): string[];
}

export interface NarrativeMemoryLike {
  summarize(range: string, limit?: number): AnyRecord[];
  append(entry: { kind: string; text: string; metadata?: AnyRecord }): void;
}

export interface PersonaOverlayManagerLike {
  refresh(input: { memory: MemoryStore; narrativeMemory: NarrativeMemoryLike | null }): void;
}

export interface DispatcherDeps {
  agents: AgentLike[];
  memory: MemoryStore;
  cache: TranslationCache;
  modelGateway: ModelGatewayLike | null;
  graphClient: GraphClientLike | null;
  teamsIndex?: TeamsIndexLike | null;
  teamsRankingConfig?: AnyRecord;
  entityGraph?: EntityGraphLike | null;
  personaContext?: PersonaContext | null;
  narrativeMemory?: NarrativeMemoryLike | null;
  patternCache?: AnyRecord;
  grammarStore?: AnyRecord;
  personaOverlayManager?: PersonaOverlayManagerLike | null;
  cacheConfig?: AnyRecord;
  composerConfig?: AnyRecord;
}

export abstract class ModelProvider {
  name: string;

  constructor(name: string) {
    this.name = name;
  }

  async complete(_messages: ComposerMessage[], _options: AnyRecord = {}): Promise<unknown> {
    throw new Error(`Provider ${this.name} must implement complete()`);
  }
}

export abstract class Agent {
  id: string;
  description: string;

  constructor(id: string, description: string) {
    this.id = id;
    this.description = description;
  }

  async canHandle(_input: string): Promise<boolean> {
    return false;
  }

  async handle(_input: string, _context: AnyRecord): Promise<unknown> {
    throw new Error(`Agent ${this.id} must implement handle()`);
  }
}

export abstract class MemoryStore {
  addTurn(_turn: MemoryTurn): void {
    throw new Error("MemoryStore.addTurn() not implemented");
  }

  query(_naturalLanguageQuery: string, _options: AnyRecord = {}): MemoryQueryResult {
    throw new Error("MemoryStore.query() not implemented");
  }
}

export abstract class TranslationCache {
  get(_request: string): DispatcherResponse | null {
    throw new Error("TranslationCache.get() not implemented");
  }

  set(_request: string, _translation: DispatcherResponse): void {
    throw new Error("TranslationCache.set() not implemented");
  }
}
