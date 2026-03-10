# Retrieval Guidance for `microagent`

Repository: `mtweimer/microagent`

## Design stance

Build a minimal but highly accurate retrieval system first.

Do not start by maximizing source count, embedding complexity, or autonomous looping. Start by making retrieval:

- explainable
- source-aware
- entity-aware
- token-budgeted
- benchmarkable

## Architectural principle

Dispatcher routes. Retrieval gathers. Composer packages. Agents act. Memory records.

Keep these boundaries strict.

### Dispatcher / Harness
Responsibilities:
- intent routing
- execution lifecycle
- budget management
- selecting agents/services

Should not:
- assemble ad hoc context directly
- hardcode source-specific retrieval logic

### Retrieval subsystem
Responsibilities:
- query planning
- evidence gathering
- ranking
- traversal
- packing context

Should not:
- decide final wording
- own conversation formatting

### Composer
Responsibilities:
- transform evidence pack into prompt/context
- control short vs detailed response structure
- preserve citations and provenance

Should not:
- perform fresh retrieval on its own

### Memory
Responsibilities:
- durable storage of facts, summaries, and relations
- freshness management
- source provenance

Should not:
- be treated as a generic text dump

## Recommended folder layout

src/
  core/
    retrieval/
      types/
        EvidenceTypes.ts
        RetrievalPlan.ts
        RetrievalResult.ts
      planner/
        RetrievalPlanner.ts
      gatherers/
        Gatherer.ts
        SessionMemoryGatherer.ts
        StructuredMemoryGatherer.ts
        NarrativeMemoryGatherer.ts
        TeamsIndexGatherer.ts
        EntityGraphGatherer.ts
        GraphApiGatherer.ts
      ranking/
        Ranker.ts
        DiversityPolicy.ts
      traversal/
        TraversalEngine.ts
        ExpansionPolicy.ts
      packing/
        ContextPacker.ts
      eval/
        RetrievalBench.ts

## Core contracts

### RetrievedEvidence

```ts
export interface RetrievedEvidence {
  id: string;
  source: string;
  sourceType:
    | "turn-memory"
    | "session-memory"
    | "structured-memory"
    | "narrative-memory"
    | "teams-index"
    | "entity-graph"
    | "graph-api"
    | "cache"
    | "session-ref";
  title?: string;
  snippet: string;
  raw?: unknown;
  score?: number;
  confidence?: number;
  recency?: number;
  tokenCostEstimate?: number;
  entityRefs?: string[];
  parentRefs?: string[];
  timestamp?: string;
  provenance?: {
    locator?: string;
    externalId?: string;
    query?: string;
    gatheredBy?: string;
  };
}
```

### RetrievalPlan

```ts
export interface RetrievalPlan {
  intent:
    | "exact"
    | "lookup"
    | "contextual"
    | "exploratory"
    | "comparative"
    | "timeline";
  query: string;
  entities: string[];
  sources: string[];
  traversalMode?: "none" | "drill-down" | "drill-out" | "fan-out";
  maxItems: number;
  maxDepth: number;
  tokenBudget: number;
}
```

### Gatherer

```ts
export interface Gatherer {
  name: string;
  supports(plan: RetrievalPlan): boolean;
  gather(plan: RetrievalPlan): Promise<RetrievedEvidence[]>;
}
```

## Retrieval sequence

1. Intent and entity detection
2. Plan selection
3. Initial gather
4. Expansion only if confidence is insufficient
5. Ranking
6. Packing
7. Response composition
8. Memory write-back

## How to use drill-down / drill-out / fan-out

### Drill-down
Use when the user wants exact proof, exact messages, exact files, or exact objects.

### Drill-out
Use when the user asks why something happened or what was happening around it.

### Fan-out
Use when a seed entity may connect to multiple relevant branches.

## Retrieval rules for Microsoft-focused tasks

### Identity and access questions
Prefer:
- structured memory
- entity graph
- Graph API gatherer

### Teams conversation questions
Prefer:
- Teams local index
- session refs
- narrative memory for summaries

### Files and sharing questions
Prefer:
- Graph file/site adapters
- entity graph
- related conversation artifacts

### App/service principal investigations
Prefer:
- Graph API gatherer
- entity graph
- structured memory

## Keep retrieval minimal

Avoid early:
- uncontrolled embeddings everywhere
- giant context stuffing
- autonomous loops without stop conditions
- memory writes for every interaction
- domain agents each inventing their own retrieval logic

Prefer early:
- strong interfaces
- exact matching where possible
- entity normalization
- deterministic ranking features
- provenance everywhere
- repeatable benchmarks

## Benchmark guidance

Create a benchmark corpus with:
- exact object lookups
- permission lineage questions
- Teams thread reconstruction
- temporal change questions
- compare-two-entities tasks
- blast-radius analysis

For each benchmark, store:
- user prompt
- expected entities
- expected sources
- expected top evidence
- acceptable answer traits
- failure modes

## Practical implementation notes

### First code changes
- add retrieval interfaces
- wrap current retrieval sources as gatherers
- insert retrieval stage before composer
- move source-specific query logic out of dispatcher branches

### First quality changes
- add evidence scoring
- add diversity rules
- add exact-entity boosts
- keep overflow evidence available for follow-up turns

### First evaluation changes
- record retrieval traces
- record evidence actually used in responses
- add regression prompts for Microsoft investigations

## Final recommendation

The most important change is organizational:

stop treating retrieval as a side effect of dispatch.

Treat retrieval as its own engine with explicit contracts, scoring, traversal, and packing.

That will let you:
- compare models cleanly
- experiment with loops safely
- improve Microsoft-specific retrieval without bloating the whole system
- evolve toward a stronger CLI and orchestrated agent runtime later
