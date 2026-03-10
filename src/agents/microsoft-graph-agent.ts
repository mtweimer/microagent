import { Agent } from "../core/contracts.js";
import type { AnyRecord, MemoryQueryHit } from "../core/contracts.js";

const KEYWORDS = {
  outlook: ["email", "outlook", "mail", "inbox", "reply", "send"],
  calendar: ["calendar", "meeting", "schedule", "event", "invite"],
  teams: ["teams", "channel", "chat", "standup", "meeting notes"],
  sharepoint: ["sharepoint", "site", "document library"],
  onedrive: ["onedrive", "file", "folder", "upload", "sync"]
} as const;

type GraphDomain = keyof typeof KEYWORDS;

interface GraphPlanResult {
  type: "plan" | "noop";
  text: string;
  domain: GraphDomain | null;
  followups?: string[];
  contextSummary?: MemoryQueryHit[];
}

function findDomain(input: string): GraphDomain | null {
  const lower = input.toLowerCase();
  for (const [domain, words] of Object.entries(KEYWORDS) as Array<[GraphDomain, readonly string[]]>) {
    if (words.some((w) => lower.includes(w))) return domain;
  }
  return null;
}

export class MicrosoftGraphAgent extends Agent {
  constructor() {
    super(
      "microsoft-graph",
      "Handles Microsoft 365 intents (Outlook, Calendar, Teams, SharePoint, OneDrive)."
    );
  }

  override async canHandle(input: string): Promise<boolean> {
    return findDomain(input) !== null;
  }

  override async handle(input: string, context: AnyRecord): Promise<GraphPlanResult> {
    const domain = findDomain(input);
    if (!domain) {
      return {
        type: "noop",
        text: "I could not map this request to a Microsoft Graph domain.",
        domain: null
      };
    }

    return {
      type: "plan",
      domain,
      text: `Planned ${domain} action for: ${input}`,
      followups: [
        "Validate auth and scopes",
        "Translate request to typed action",
        "Execute against provider",
        "Store action result in memory"
      ],
      contextSummary:
        typeof context.memory === "object" &&
        context.memory !== null &&
        "query" in context.memory &&
        typeof (context.memory as { query?: (text: string, options?: AnyRecord) => { results?: MemoryQueryHit[] } }).query === "function"
          ? ((context.memory as { query: (text: string, options?: AnyRecord) => { results?: MemoryQueryHit[] } }).query(input, { topK: 3 }).results ?? [])
          : []
    };
  }
}
