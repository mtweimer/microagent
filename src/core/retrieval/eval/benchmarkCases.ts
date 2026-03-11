export interface RetrievalBenchCase {
  id: string;
  prompt: string;
  expectedIntent?: string;
  expectedSources?: string[];
  expectedEntities?: string[];
  expectedTopSource?: string;
  expectedTopTitleIncludes?: string[];
  failureModes?: string[];
}

export const benchmarkCases: RetrievalBenchCase[] = [
  {
    id: "outlook-last-email",
    prompt: "read my last email",
    expectedIntent: "exact",
    expectedSources: ["session-refs", "structured-memory"],
    expectedTopSource: "session-ref",
    failureModes: ["narrative summary outranks exact reference"]
  },
  {
    id: "outlook-importance-followup",
    prompt: "is that email important?",
    expectedIntent: "exact",
    expectedSources: ["session-refs", "structured-memory"],
    expectedTopSource: "session-ref"
  },
  {
    id: "outlook-repeat-search",
    prompt: "search my email for invoices again",
    expectedIntent: "lookup",
    expectedSources: ["session-refs", "structured-memory", "cache"],
    expectedTopSource: "cache"
  },
  {
    id: "outlook-client-followups",
    prompt: "review followups for Valeo",
    expectedIntent: "contextual",
    expectedSources: ["structured-memory", "narrative-memory", "entity-graph"],
    expectedEntities: ["Valeo"]
  },
  {
    id: "outlook-client-exact",
    prompt: "what did Valeo want?",
    expectedIntent: "exact",
    expectedSources: ["session-refs", "structured-memory", "entity-graph"],
    expectedEntities: ["Valeo"]
  },
  {
    id: "teams-review-today",
    prompt: "did I miss anything in Teams today?",
    expectedIntent: "timeline",
    expectedSources: ["session-refs", "narrative-memory", "teams-index"],
    expectedTopSource: "teams-index"
  },
  {
    id: "teams-client-thread",
    prompt: "what happened in the Valeo Teams thread?",
    expectedIntent: "exact",
    expectedSources: ["session-refs", "teams-index", "entity-graph"],
    expectedEntities: ["Valeo"],
    expectedTopSource: "teams-index"
  },
  {
    id: "teams-client-context",
    prompt: "give me the context around Valeo in Teams",
    expectedIntent: "contextual",
    expectedSources: ["structured-memory", "narrative-memory", "teams-index", "entity-graph"],
    expectedEntities: ["Valeo"]
  },
  {
    id: "teams-project-search",
    prompt: "search Teams for KSM",
    expectedIntent: "lookup",
    expectedSources: ["session-refs", "structured-memory", "teams-index", "entity-graph"],
    expectedEntities: ["KSM"],
    expectedTopSource: "teams-index"
  },
  {
    id: "teams-timeline",
    prompt: "what changed in Teams this week for KSM?",
    expectedIntent: "timeline",
    expectedSources: ["session-refs", "narrative-memory", "teams-index", "entity-graph"],
    expectedEntities: ["KSM"]
  },
  {
    id: "review-general",
    prompt: "review today",
    expectedIntent: "timeline",
    expectedSources: ["session-refs", "narrative-memory"],
    failureModes: ["planner over-includes cache"]
  },
  {
    id: "review-client",
    prompt: "review client Valeo",
    expectedIntent: "contextual",
    expectedSources: ["structured-memory", "narrative-memory", "entity-graph"],
    expectedEntities: ["Valeo"]
  },
  {
    id: "review-project",
    prompt: "review project KSM",
    expectedIntent: "contextual",
    expectedSources: ["structured-memory", "narrative-memory", "entity-graph"],
    expectedEntities: ["KSM"]
  },
  {
    id: "review-comparative",
    prompt: "compare Valeo and KSM activity this week",
    expectedIntent: "comparative",
    expectedSources: ["entity-graph", "structured-memory", "narrative-memory"],
    expectedEntities: ["Valeo", "KSM"]
  },
  {
    id: "timeline-client",
    prompt: "timeline for Valeo this week",
    expectedIntent: "timeline",
    expectedSources: ["session-refs", "narrative-memory", "entity-graph"],
    expectedEntities: ["Valeo"]
  },
  {
    id: "timeline-project",
    prompt: "what happened before the KSM review meeting?",
    expectedIntent: "timeline",
    expectedSources: ["session-refs", "narrative-memory", "structured-memory", "entity-graph"],
    expectedEntities: ["KSM"]
  },
  {
    id: "identity-company",
    prompt: "what company do I work for?",
    expectedIntent: "lookup",
    expectedSources: ["session-refs", "structured-memory"],
    expectedTopTitleIncludes: ["user turn", "assistant turn"]
  },
  {
    id: "identity-client-context",
    prompt: "who is Valeo in my work?",
    expectedIntent: "lookup",
    expectedSources: ["session-refs", "structured-memory", "entity-graph"],
    expectedEntities: ["Valeo"]
  },
  {
    id: "graph-scope-question",
    prompt: "what can you access in Microsoft Graph?",
    expectedIntent: "lookup",
    expectedSources: ["session-refs", "structured-memory"],
    failureModes: ["entity graph dominates a capability question"]
  },
  {
    id: "followup-response-needed",
    prompt: "should I respond to that?",
    expectedIntent: "contextual",
    expectedSources: ["structured-memory", "narrative-memory", "session-refs"],
    expectedTopSource: "session-ref"
  },
  {
    id: "followup-thread-context",
    prompt: "what was that thread about?",
    expectedIntent: "exact",
    expectedSources: ["session-refs", "teams-index", "structured-memory"],
    expectedTopSource: "session-ref"
  },
  {
    id: "client-account-summary",
    prompt: "summarize what matters for Valeo right now",
    expectedIntent: "contextual",
    expectedSources: ["structured-memory", "narrative-memory", "entity-graph"],
    expectedEntities: ["Valeo"]
  },
  {
    id: "project-account-summary",
    prompt: "summarize what matters for KSM right now",
    expectedIntent: "contextual",
    expectedSources: ["structured-memory", "narrative-memory", "entity-graph"],
    expectedEntities: ["KSM"]
  },
  {
    id: "teams-vs-email",
    prompt: "compare Teams and email activity for Valeo",
    expectedIntent: "comparative",
    expectedSources: ["entity-graph", "structured-memory", "narrative-memory", "teams-index"],
    expectedEntities: ["Valeo"]
  }
];
