import { detectUnsupportedRequest } from "./capabilityPack.js";

const ACTION_LIKE = [
  "set",
  "set up",
  "schedule",
  "create",
  "send",
  "search",
  "find",
  "fetch",
  "retrieve",
  "get",
  "show",
  "list",
  "read",
  "review",
  "examine",
  "summarize",
  "summarise",
  "check"
];

const RETRIEVAL_HINTS = [
  "search",
  "find",
  "fetch",
  "retrieve",
  "get",
  "show",
  "list",
  "read",
  "review",
  "examine",
  "summarize",
  "summarise",
  "latest",
  "recent",
  "today",
  "unread"
];

const SIDE_EFFECT_HINTS = ["send", "schedule", "create", "set up", "draft", "reply", "delete"];

export function decideRoute({ input, domain, selection, intent }) {
  const lower = String(input ?? "").toLowerCase().trim();
  const unsupported = detectUnsupportedRequest(lower);
  if (unsupported.unsupported) {
    return {
      mode: "unsupported",
      domain: null,
      actionHint: null,
      confidence: 1,
      needsClarification: false,
      clarificationQuestion: null,
      unsupportedReason: unsupported.reason
    };
  }

  if (selection?.ambiguous) {
    return {
      mode: "clarify",
      domain: null,
      actionHint: null,
      confidence: 0.5,
      needsClarification: true,
      clarificationQuestion: `I can route this to ${selection.candidates.map((c) => c.domain).join(", ")}. Which workstream did you mean?`,
      unsupportedReason: null
    };
  }

  if (!domain) {
    if (looksActionLike(lower)) {
      return {
        mode: "clarify",
        domain: null,
        actionHint: null,
        confidence: 0.4,
        needsClarification: true,
        clarificationQuestion: "I need clarification: is this Outlook, Calendar, Teams, SharePoint, or OneDrive related?",
        unsupportedReason: null
      };
    }
    return {
      mode: "chat",
      domain: null,
      actionHint: null,
      confidence: 0.8,
      needsClarification: false,
      clarificationQuestion: null,
      unsupportedReason: null
    };
  }

  if (intent?.type === "clarify") {
    if (hasAny(lower, SIDE_EFFECT_HINTS)) {
      return {
        mode: "action",
        domain,
        actionHint: "side_effect",
        confidence: 0.7,
        needsClarification: false,
        clarificationQuestion: null,
        unsupportedReason: null
      };
    }
    if (hasAny(lower, RETRIEVAL_HINTS) || lower.includes("?")) {
      return {
        mode: "retrieval",
        domain,
        actionHint: "read_only",
        confidence: 0.7,
        needsClarification: false,
        clarificationQuestion: null,
        unsupportedReason: null
      };
    }
    return {
      mode: "chat",
      domain: null,
      actionHint: null,
      confidence: 0.7,
      needsClarification: false,
      clarificationQuestion: null,
      unsupportedReason: null
    };
  }

  if (hasAny(lower, SIDE_EFFECT_HINTS)) {
    return {
      mode: "action",
      domain,
      actionHint: "side_effect",
      confidence: 0.75,
      needsClarification: false,
      clarificationQuestion: null,
      unsupportedReason: null
    };
  }

  if (hasAny(lower, RETRIEVAL_HINTS) || lower.includes("?")) {
    return {
      mode: "retrieval",
      domain,
      actionHint: "read_only",
      confidence: 0.75,
      needsClarification: false,
      clarificationQuestion: null,
      unsupportedReason: null
    };
  }

  return {
    mode: "chat",
    domain: null,
    actionHint: null,
    confidence: 0.6,
    needsClarification: false,
    clarificationQuestion: null,
    unsupportedReason: null
  };
}

function hasAny(text, patterns) {
  return patterns.some((p) => text.includes(p));
}

function looksActionLike(lower) {
  return ACTION_LIKE.some((prefix) => lower.startsWith(prefix + " ") || lower === prefix);
}
