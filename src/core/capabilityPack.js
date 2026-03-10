import { ACTION_REGISTRY, listDomains, getActionsByDomain } from "../contracts/actionRegistry.js";

const UNSUPPORTED_KEYWORDS = [
  "weather",
  "forecast",
  "temperature",
  "stock price",
  "sports score",
  "news headline"
];

export function getCapabilityPack() {
  const supportedDomains = listDomains();
  const supportedActions = {};
  for (const domain of supportedDomains) {
    supportedActions[domain] = getActionsByDomain(domain);
  }
  return {
    supportedDomains,
    supportedActions,
    unsupportedKeywords: UNSUPPORTED_KEYWORDS,
    policy: "decline_and_offer_supported"
  };
}

export function detectUnsupportedRequest(input) {
  const lower = String(input ?? "").toLowerCase();
  const matched = UNSUPPORTED_KEYWORDS.find((k) => lower.includes(k));
  if (!matched) return { unsupported: false, reason: null };
  return {
    unsupported: true,
    reason: `unsupported_capability:${matched}`
  };
}

export function suggestSupportedAlternatives(input) {
  const lower = String(input ?? "").toLowerCase();
  if (lower.includes("weather") || lower.includes("forecast")) {
    return [
      "Review today's calendar",
      "Search your inbox for urgent updates",
      "Run /review today for a work summary"
    ];
  }
  return [
    "Search your email",
    "Check your calendar",
    "Run /review today",
    "Ask about a client, project, or recent message"
  ];
}

export function formatCapabilities() {
  const pack = getCapabilityPack();
  return {
    domains: pack.supportedDomains.map((domain) => ({
      domain,
      agent: ACTION_REGISTRY[domain].agentId,
      actions: pack.supportedActions[domain]
    })),
    unsupportedKeywords: pack.unsupportedKeywords,
    policy: pack.policy
  };
}
