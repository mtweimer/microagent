// @ts-nocheck
import { Agent } from "../core/contracts.js";

const KEYWORDS = {
  outlook: ["email", "outlook", "mail", "inbox", "reply", "send"],
  calendar: ["calendar", "meeting", "schedule", "event", "invite"],
  teams: ["teams", "channel", "chat", "standup", "meeting notes"],
  sharepoint: ["sharepoint", "site", "document library"],
  onedrive: ["onedrive", "file", "folder", "upload", "sync"]
};

function findDomain(input) {
  const lower = input.toLowerCase();
  for (const [domain, words] of Object.entries(KEYWORDS)) {
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

  async canHandle(input) {
    return findDomain(input) !== null;
  }

  async handle(input, context) {
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
      contextSummary: context.memory.query(input, { topK: 3 }).results
    };
  }
}
