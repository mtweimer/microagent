# Retrieval Improvement Phases for `microagent`

Repository: `mtweimer/microagent`

## Goal

Drastically improve retrieval quality while preserving the existing organization already present in the codebase: dispatcher/harness, composer, memory layers, Teams/local index, entity graph, and agent manifests.

The core recommendation is to promote retrieval into a first-class subsystem instead of leaving it fragmented across dispatcher logic, memory lookups, ad hoc context assembly, and per-agent behavior.

## Current strengths to preserve

- Central dispatcher/harness coordinating execution state
- Dual-path composer for deterministic and model-backed composition
- Multiple memory forms: turn/session, structured SQLite, narrative summaries
- Domain retrieval substrates: Teams/local index, entity graph, session refs, cache
- Manifest-driven agents

## Target retrieval architecture

Create a dedicated retrieval subsystem:

`src/core/retrieval/`

Recommended modules:

- `RetrievalPlanner.ts`
- `RetrievalEngine.ts`
- `GathererRegistry.ts`
- `Ranker.ts`
- `TraversalEngine.ts`
- `ContextPacker.ts`
- `EvidenceTypes.ts`
- `RetrievalBench.ts`

Recommended gatherers:

- `SessionMemoryGatherer`
- `StructuredMemoryGatherer`
- `NarrativeMemoryGatherer`
- `TeamsIndexGatherer`
- `EntityGraphGatherer`
- `GraphApiGatherer`
- `SessionRefsGatherer`
- `CacheGatherer`

# Phase 0 — Baseline and inventory

## Objective

Stabilize current retrieval, make it observable, and define the evaluation target.

## Deliverables

- Retrieval subsystem folder and interfaces
- Inventory of all existing retrieval inputs
- Baseline benchmark prompts
- Logging for retrieval decisions and evidence provenance

## Actions

1. Enumerate all retrieval sources currently used in the dispatcher/composer path.
2. Define a common `RetrievedEvidence` contract.
3. Add tracing for source used, latency, tokens contributed, ranking score, and whether evidence was actually cited.
4. Build a baseline benchmark suite of representative tasks.
5. Capture quality manually before changing retrieval behavior.

## Success criteria

- You can explain where every context block in a response came from.
- You can compare runs across different models and retrieval configurations.

# Phase 1 — Unify retrieval into a first-class engine

## Objective

Separate retrieval from dispatch and composition.

## Deliverables

- `RetrievalPlanner`
- `RetrievalEngine`
- `GathererRegistry`
- `ContextPacker`

## Actions

1. Add a pre-composition retrieval stage: intent, scope, budget, likely sources.
2. Wrap each current source as a gatherer.
3. Normalize all evidence.
4. Build `ContextPacker` to assemble short answer, reasoning, action, and follow-up packs.

## Success criteria

- Dispatcher no longer directly mixes retrieval logic with action routing.
- Same request can be run against different retrieval strategies consistently.

# Phase 2 — Improve ranking and selection

## Objective

Move from “retrieve many things” to “retrieve the right things.”

## Deliverables

- Heuristic ranker
- Diversity controls
- Source weighting
- Context budget policy

## Actions

1. Add weighted ranking dimensions: semantic relevance, lexical overlap, recency, entity overlap, thread proximity, graph distance, source reliability.
2. Prevent duplicate evidence.
3. Add diversity constraints so one source does not dominate.
4. Introduce hard token budgets per source.
5. Add an optional rerank pass.

## Success criteria

- Smaller but more accurate context packs.
- Better answer grounding with fewer irrelevant inserts.

# Phase 3 — Add drill-down, drill-out, and fan-out traversal

## Objective

Support natural language exploration over memory and Microsoft data.

### Drill-down
Move from broad artifact to specific evidence.

### Drill-out
Move from specific evidence to surrounding context.

### Fan-out
Branch from one seed into related entities, threads, files, meetings, users, or policies.

## Deliverables

- `TraversalEngine`
- Query expansion policies
- Entity expansion policies
- Loop budget controls

## Actions

1. Represent retrieval as graph traversal over people, groups, teams/channels, meetings, files, messages, permissions, apps/service principals, identities/devices.
2. Add traversal operators such as `seed()`, `expand_neighbors()`, `expand_time_window()`, `expand_entities()`, `narrow_to_exact()`, and `branch_related()`.
3. Add query plan shapes: exact, contextual, exploratory, comparative.
4. Add loop controls: max depth, max branches, confidence stop, redundancy stop.

## Success criteria

- The system can move inward and outward without losing provenance.
- Exploration-heavy questions no longer collapse into shallow search.

# Phase 4 — Microsoft Graph-first retrieval

## Objective

Make Microsoft-specific retrieval excellent without making the system heavyweight.

## Deliverables

- `GraphApiGatherer`
- Graph object adapters
- Entity normalization for Microsoft domains

## Actions

1. Normalize Graph objects into retrieval-friendly documents.
2. Build stable entity IDs and aliases.
3. Support relation extraction: member of, owns, invited by, shared with, granted, linked to meeting, file attached to thread.
4. Add targeted retrieval plans for common Microsoft tasks.

## Success criteria

- Microsoft-related questions resolve using entity-aware retrieval, not just text matching.
- Graph objects become navigable context, not raw API blobs.

# Phase 5 — Better memory model

## Objective

Make memory precise, layered, and queryable.

## Memory layers

1. Turn memory
2. Session memory
3. Structured memory
4. Narrative memory
5. Long-horizon memory

## Actions

1. Define write policies for each layer.
2. Separate facts from summaries.
3. Add conflict handling.
4. Add memory freshness and decay.
5. Add memory citation and provenance.

## Success criteria

- Memory is not just “more text.”
- The system knows what is durable, session-local, and uncertain.

# Phase 6 — Benchmarking and model comparison

## Objective

Enable clean testing of retrieval quality across models and strategies.

## Deliverables

- `RetrievalBench`
- benchmark datasets
- model comparison harness
- retrieval strategy toggles

## Metrics

- top-k evidence precision
- answer grounding
- missing-critical-context rate
- latency
- token cost
- citation usefulness
- traversal efficiency

## Success criteria

- You can swap models while holding retrieval constant.
- You can swap retrieval strategies while holding models constant.

# Phase 7 — Agent workflow optimization

## Objective

Refactor agents around retrieval-aware responsibilities.

## Recommended split

### Domain agents
IdentityAgent, TeamsAgent, FilesAgent, AppsAgent, PermissionsAgent

### Workflow agents
InvestigatorAgent, ComparatorAgent, SummarizerAgent, ExplainerAgent, EvidencePackagerAgent

### Infrastructure services
RetrievalPlanner, RetrievalEngine, TraversalEngine, ContextPacker, MemoryWriter, Ranker

## Success criteria

- Agents stop being overloaded with both domain expertise and orchestration.
- Retrieval becomes reusable across all agents.

## Suggested implementation order

1. Phase 0 baseline
2. Phase 1 unified retrieval engine
3. Phase 2 ranking + packing
4. Phase 3 traversal
5. Phase 4 Graph-first normalization
6. Phase 5 memory refinement
7. Phase 6 benchmark harness
8. Phase 7 agent role cleanup

## Immediate next build steps

1. Create `src/core/retrieval/` with common interfaces.
2. Wrap current memory, Teams index, and entity graph as gatherers.
3. Insert retrieval planning before composer invocation.
4. Add evidence tracing and context pack visualization.
5. Build 20 benchmark prompts centered on Microsoft Graph and Teams investigations.
