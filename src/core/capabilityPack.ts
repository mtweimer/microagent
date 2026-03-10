import { ACTION_REGISTRY, getActionsByDomain, listDomains, type DomainName } from "../contracts/actionRegistry.js";
import type { CapabilityPack } from "./contracts.js";

const UNSUPPORTED_KEYWORDS = [
  "weather",
  "forecast",
  "temperature",
  "stock price",
  "sports score",
  "news headline"
] as const;

export function getCapabilityPack(): CapabilityPack {
  const supportedDomains = listDomains();
  const supportedActions: Record<string, string[]> = {};
  for (const domain of supportedDomains) {
    supportedActions[domain] = getActionsByDomain(domain);
  }
  return {
    supportedDomains,
    supportedActions,
    unsupportedKeywords: [...UNSUPPORTED_KEYWORDS],
    policy: "decline_and_offer_supported"
  };
}

export function detectUnsupportedRequest(input: string): { unsupported: boolean; reason: string | null } {
  const lower = String(input ?? "").toLowerCase();
  const matched = UNSUPPORTED_KEYWORDS.find((keyword) => lower.includes(keyword));
  if (!matched) return { unsupported: false, reason: null };
  return {
    unsupported: true,
    reason: `unsupported_capability:${matched}`
  };
}

export function suggestSupportedAlternatives(input: string): string[] {
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

export function formatCapabilities(): {
  domains: Array<{ domain: string; agent: string; actions: string[] }>;
  unsupportedKeywords: string[];
  policy: string;
} {
  const pack = getCapabilityPack();
  return {
    domains: pack.supportedDomains.map((domain) => ({
      domain,
      agent: ACTION_REGISTRY[domain as DomainName].agentId,
      actions: pack.supportedActions[domain] ?? []
    })),
    unsupportedKeywords: pack.unsupportedKeywords,
    policy: pack.policy
  };
}
