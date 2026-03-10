import { buildTriageItems, summarizeTriage } from "./triageClassifier.js";
import { updateSessionRefsFromReview } from "./dispatcherPipeline/sessionRefs.js";

function buildNarrative(target, triageItems, outputs, focus = null) {
  const lines = [];
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

function buildReviewSuggestions(triageItems = []) {
  const suggestions = [];
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

function buildReviewPrompts(target, hasTeams) {
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

function buildScopedPrompts(name, hasTeams) {
  const prompts = [`search my email for ${name}`, "what's on my calendar for today"];
  if (hasTeams) prompts.push(`search teams for ${name}`);
  return prompts;
}

function normalizeForMatch(value) {
  return String(value ?? "").toLowerCase();
}

function matchesFocus(item, aliases) {
  if (!aliases.length) return true;
  const haystack = normalizeForMatch(
    `${item.title}\n${item.rationale}\n${JSON.stringify(item.evidence ?? [])}`
  );
  return aliases.some((alias) => haystack.includes(normalizeForMatch(alias)));
}

function scoreFocusedItem(item, aliases) {
  let score = 0;
  const haystack = normalizeForMatch(
    `${item.title}\n${item.rationale}\n${JSON.stringify(item.evidence ?? [])}`
  );
  for (const alias of aliases) {
    const normalized = normalizeForMatch(alias);
    if (!normalized) continue;
    if (haystack.includes(normalized)) score += Math.max(1, normalized.split(/\s+/).length);
  }
  return score;
}

function filterAndRankFocusedItems(items, aliases) {
  return items
    .filter((item) => matchesFocus(item, aliases))
    .sort((a, b) => scoreFocusedItem(b, aliases) - scoreFocusedItem(a, aliases));
}

export async function runReviewOrchestrator({ target, dispatcher, entityGraph, focus = null }) {
  const hasTeams = dispatcher.agents.some((a) => a.id === "ms.teams");
  const prompts = focus?.name ? buildScopedPrompts(focus.name, hasTeams) : buildReviewPrompts(target, hasTeams);
  const outputs = [];
  for (const prompt of prompts) {
    const out = await dispatcher.route(prompt);
    outputs.push(out);
  }
  const baseItems = buildTriageItems(outputs);
  const aliases = focus?.name
    ? [...new Set([focus.name, ...(entityGraph?.aliasesFor(focus.name) ?? [])])]
    : [];
  const triageItems = focus?.name ? filterAndRankFocusedItems(baseItems, aliases) : baseItems;
  const suggestions = outputs.flatMap((o, idx) =>
    (o.suggestedActions ?? []).map((s, sidx) => ({
      ...s,
      id: `r${idx + 1}-${s.id ?? `s${sidx + 1}`}`
    }))
  );
  const reviewSuggestions = buildReviewSuggestions(triageItems);
  if (entityGraph) {
    for (const out of outputs) {
      if (out?.artifacts?.action && out?.artifacts?.result) {
        entityGraph.observeExecution(out.artifacts.action, out.artifacts.result);
      }
    }
  }
  dispatcher.sessionRefs = updateSessionRefsFromReview(dispatcher.sessionRefs, {
    target: focus?.name ? `${focus.kind}:${focus.name}` : target,
    triageItems
  });
  return {
    requestId: `review-${Date.now()}`,
    status: outputs.some((o) => o.status === "error") ? "error" : "ok",
    message: "Review completed.",
    finalText: buildNarrative(target, triageItems, outputs, focus),
    suggestedActions: [...reviewSuggestions, ...suggestions],
    evidence: outputs.flatMap((o) => o.evidence ?? []).slice(0, 8),
    artifacts: {
      reviewTarget: target,
      reviewFocus: focus,
      items: outputs,
      triageItems
    },
    conversationMode: "review"
  };
}
