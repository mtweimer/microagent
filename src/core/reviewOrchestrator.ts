import { buildTriageItems, summarizeTriage } from "./triageClassifier.js";
import { updateSessionRefsFromReview } from "./dispatcherPipeline/sessionRefs.js";
import type {
  AnyRecord,
  DispatcherResponse,
  EntityGraphLike,
  ReviewFocus,
  SuggestedAction,
  TriageItem
} from "./contracts.js";

interface DispatcherLike {
  agents: Array<{ id: string }>;
  sessionRefs: import("./contracts.js").SessionRefs;
  route(prompt: string): Promise<DispatcherResponse>;
}

function buildNarrative(
  target: string,
  triageItems: TriageItem[],
  outputs: DispatcherResponse[],
  focus: ReviewFocus | null = null
): string {
  const lines: string[] = [];
  if (focus?.name) {
    lines.push(`I reviewed recent activity for ${focus.kind} '${focus.name}'.`);
  } else {
    lines.push(target === "missed" ? "I reviewed what you may have missed." : "I reviewed your day across your active workstreams.");
  }
  lines.push(summarizeTriage(triageItems));
  for (const item of triageItems.slice(0, 5)) {
    lines.push("");
    lines.push(`${item.title} [${item.priority}]`);
    lines.push(`Why this matters: ${item.rationale}`);
  }
  if (triageItems.length === 0) {
    for (const out of outputs) {
      if (out?.finalText) {
        lines.push("");
        lines.push(out.finalText);
      }
    }
  }
  return lines.join("\n");
}

function buildReviewSuggestions(triageItems: TriageItem[] = []): SuggestedAction[] {
  const suggestions: SuggestedAction[] = [];
  for (const item of triageItems.slice(0, 3)) {
    if (item.sourceDomain === "outlook") {
      suggestions.push({
        id: `review-open-${item.sourceArtifactId}`,
        title: `Open email: ${item.title}`,
        rationale: "Inspect the underlying email before deciding whether to respond.",
        risk: "low",
        evidence: item.evidence ?? [],
        actionEnvelope: {
          agent: "ms.outlook",
          action: "read_email",
          params: { id: item.sourceArtifactId }
        }
      });
    } else if (item.sourceDomain === "teams") {
      suggestions.push({
        id: `review-open-${item.sourceArtifactId}`,
        title: `Open Teams message: ${item.title}`,
        rationale: "Inspect the message details and surrounding workspace context.",
        risk: "low",
        evidence: item.evidence ?? [],
        actionEnvelope: {
          agent: "ms.teams",
          action: "read_message",
          params: { id: item.sourceArtifactId }
        }
      });
    }
  }
  return suggestions;
}

function buildReviewPrompts(target: string, hasTeams: boolean): string[] {
  if (target === "today") {
    const prompts = ["what's on my calendar for today", "search my email for unread messages today"];
    if (hasTeams) prompts.push("did i miss anything in teams today?");
    return prompts;
  }
  if (target === "missed") {
    const prompts = ["what's on my calendar for today", "search my email for unread messages"];
    if (hasTeams) prompts.push("did anyone mention me in teams today?");
    return prompts;
  }
  if (target === "followups") {
    const prompts = ["search my email for unread messages today"];
    if (hasTeams) prompts.push("did i miss anything in teams today?");
    return prompts;
  }
  throw new Error("Unsupported review target");
}

function buildScopedPrompts(name: string, hasTeams: boolean): string[] {
  const prompts = [`search my email for ${name}`, "what's on my calendar for today"];
  if (hasTeams) prompts.push(`search teams for ${name}`);
  return prompts;
}

function normalizeForMatch(value: unknown): string {
  return String(value ?? "").toLowerCase();
}

function matchesFocus(item: TriageItem, aliases: string[]): boolean {
  if (!aliases.length) return true;
  const haystack = normalizeForMatch(`${item.title}\n${item.rationale}\n${JSON.stringify(item.evidence ?? [])}`);
  return aliases.some((alias) => haystack.includes(normalizeForMatch(alias)));
}

function scoreFocusedItem(item: TriageItem, aliases: string[]): number {
  let score = 0;
  const haystack = normalizeForMatch(`${item.title}\n${item.rationale}\n${JSON.stringify(item.evidence ?? [])}`);
  for (const alias of aliases) {
    const normalized = normalizeForMatch(alias);
    if (!normalized) continue;
    if (haystack.includes(normalized)) score += Math.max(1, normalized.split(/\s+/).length);
  }
  return score;
}

function filterAndRankFocusedItems(items: TriageItem[], aliases: string[]): TriageItem[] {
  return items
    .filter((item) => matchesFocus(item, aliases))
    .sort((a, b) => scoreFocusedItem(b, aliases) - scoreFocusedItem(a, aliases));
}

export async function runReviewOrchestrator({
  target,
  dispatcher,
  entityGraph,
  focus = null
}: {
  target: string;
  dispatcher: DispatcherLike;
  entityGraph: EntityGraphLike | null | undefined;
  focus?: ReviewFocus | null;
}): Promise<DispatcherResponse> {
  const hasTeams = dispatcher.agents.some((agent) => agent.id === "ms.teams");
  const prompts = focus?.name ? buildScopedPrompts(focus.name, hasTeams) : buildReviewPrompts(target, hasTeams);
  const outputs: DispatcherResponse[] = [];
  for (const prompt of prompts) {
    outputs.push(await dispatcher.route(prompt));
  }
  const baseItems = buildTriageItems(outputs);
  const aliases = focus?.name
    ? [...new Set([focus.name, ...(entityGraph?.aliasesFor?.(focus.name) ?? [])])]
    : [];
  const triageItems = focus?.name ? filterAndRankFocusedItems(baseItems, aliases) : baseItems;
  const suggestions = outputs.flatMap((output, idx) =>
    (output.suggestedActions ?? []).map((suggestion, suggestionIndex) => ({
      ...suggestion,
      id: `r${idx + 1}-${suggestion.id ?? `s${suggestionIndex + 1}`}`
    }))
  );
  const reviewSuggestions = buildReviewSuggestions(triageItems);
  if (entityGraph?.observeExecution) {
    for (const output of outputs) {
      if (output?.artifacts?.action && output?.artifacts?.result) {
        entityGraph.observeExecution(output.artifacts.action, output.artifacts.result);
      }
    }
  }
  dispatcher.sessionRefs = updateSessionRefsFromReview(dispatcher.sessionRefs, {
    target: focus?.name ? `${focus.kind}:${focus.name}` : target,
    triageItems
  });
  return {
    requestId: `review-${Date.now()}`,
    status: outputs.some((output) => output.status === "error") ? "error" : "ok",
    message: "Review completed.",
    finalText: buildNarrative(target, triageItems, outputs, focus),
    suggestedActions: [...reviewSuggestions, ...suggestions],
    evidence: outputs.flatMap((output) => output.evidence ?? []).slice(0, 8),
    artifacts: {
      reviewTarget: target,
      reviewFocus: focus,
      items: outputs,
      triageItems
    },
    conversationMode: "review",
    memoryRefs: [],
    trace: {
      traceId: "",
      requestId: "",
      provider: "none",
      model: "none",
      translationSource: "none",
      schemaVersion: "1.0.0",
      agent: "review",
      cacheHit: false,
      stageTimingsMs: {},
      validationErrors: [],
      executionError: null,
      timestamp: new Date().toISOString()
    }
  };
}
