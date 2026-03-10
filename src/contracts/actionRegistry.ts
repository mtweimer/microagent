import type { ActionConfig, DomainConfig, DomainRank } from "../core/contracts.js";

export const ACTION_REGISTRY_VERSION = "1.0.0";

export const ACTION_REGISTRY = {
  outlook: {
    agentId: "ms.outlook",
    requiredScopes: ["Mail.Read", "Mail.Send"],
    actions: {
      send_email: {
        schemaVersion: "1.0.0",
        inputSchema: {
          required: ["to", "subject", "body"],
          properties: {
            to: "array",
            subject: "string",
            body: "string"
          }
        },
        translatorHints: "Send or reply to an email using recipient addresses and message content.",
        executorCapabilities: { dryRun: false, requiresConfirmation: false }
      },
      search_email: {
        schemaVersion: "1.0.0",
        inputSchema: {
          required: ["query"],
          properties: {
            query: "string"
          }
        },
        translatorHints: "Search email messages by natural language query.",
        executorCapabilities: { dryRun: true, requiresConfirmation: false }
      },
      list_recent_emails: {
        schemaVersion: "1.0.0",
        inputSchema: {
          required: [],
          properties: {
            limit: "number",
            folder: "string"
          }
        },
        translatorHints: "List the most recent emails, optionally with a limit or folder.",
        executorCapabilities: { dryRun: true, requiresConfirmation: false }
      },
      read_email: {
        schemaVersion: "1.0.0",
        inputSchema: {
          required: [],
          properties: {
            id: "string",
            reference: "string"
          }
        },
        translatorHints: "Read a specific email by id or session reference like latest.",
        executorCapabilities: { dryRun: true, requiresConfirmation: false }
      }
    }
  },
  calendar: {
    agentId: "ms.calendar",
    requiredScopes: ["Calendars.ReadWrite"],
    actions: {
      schedule_event: {
        schemaVersion: "1.0.0",
        inputSchema: {
          required: ["title", "when"],
          properties: {
            title: "string",
            when: "string",
            attendees: "array"
          }
        },
        translatorHints: "Schedule or create a calendar event with optional attendees.",
        executorCapabilities: { dryRun: false, requiresConfirmation: false }
      },
      find_events: {
        schemaVersion: "1.0.0",
        inputSchema: {
          required: ["timeRange"],
          properties: {
            timeRange: "string"
          }
        },
        translatorHints: "Find upcoming or time-bounded calendar events.",
        executorCapabilities: { dryRun: true, requiresConfirmation: false }
      }
    }
  },
  teams: {
    agentId: "ms.teams",
    requiredScopes: ["Chat.Read"],
    actions: {
      review_my_day: {
        schemaVersion: "1.0.0",
        inputSchema: {
          required: [],
          properties: {
            top: "number",
            surface: "string",
            window: "string",
            depth: "string"
          }
        },
        translatorHints: "Review my recent Teams activity and summarize priority items.",
        executorCapabilities: { dryRun: true, requiresConfirmation: false }
      },
      search_mentions: {
        schemaVersion: "1.0.0",
        inputSchema: {
          required: [],
          properties: {
            top: "number",
            surface: "string",
            window: "string",
            depth: "string"
          }
        },
        translatorHints: "Find recent Teams messages likely directed to me (mentions or direct asks).",
        executorCapabilities: { dryRun: true, requiresConfirmation: false }
      },
      search_messages: {
        schemaVersion: "1.0.0",
        inputSchema: {
          required: ["query"],
          properties: {
            query: "string",
            top: "number",
            surface: "string",
            window: "string",
            depth: "string",
            team: "string",
            channel: "string"
          }
        },
        translatorHints: "Search Teams messages.",
        executorCapabilities: { dryRun: true, requiresConfirmation: false }
      },
      read_message: {
        schemaVersion: "1.0.0",
        inputSchema: {
          required: [],
          properties: {
            id: "string"
          }
        },
        translatorHints: "Read a specific Teams message by id from indexed results or prior context.",
        executorCapabilities: { dryRun: true, requiresConfirmation: false }
      }
    }
  },
  sharepoint: {
    agentId: "ms.sharepoint",
    requiredScopes: ["Sites.Read.All"],
    actions: {
      search_documents: {
        schemaVersion: "1.0.0",
        inputSchema: {
          required: ["query"],
          properties: { query: "string" }
        },
        translatorHints: "Search SharePoint documents.",
        executorCapabilities: { dryRun: true, requiresConfirmation: false }
      }
    }
  },
  onedrive: {
    agentId: "ms.onedrive",
    requiredScopes: ["Files.Read"],
    actions: {
      search_files: {
        schemaVersion: "1.0.0",
        inputSchema: {
          required: ["query"],
          properties: { query: "string" }
        },
        translatorHints: "Search OneDrive files.",
        executorCapabilities: { dryRun: true, requiresConfirmation: false }
      }
    }
  }
} as const satisfies Readonly<Record<string, DomainConfig>>;

const KEYWORDS = {
  outlook: ["email", "outlook", "mail", "inbox", "reply", "send", "read", "latest"],
  calendar: ["calendar", "meeting", "schedule", "event", "invite"],
  teams: ["teams", "channel", "chat", "standup", "thread"],
  sharepoint: ["sharepoint", "site", "document library", "share point"],
  onedrive: ["onedrive", "file", "folder", "upload", "sync"]
} as const satisfies Readonly<Record<keyof typeof ACTION_REGISTRY, readonly string[]>>;

export type DomainName = keyof typeof ACTION_REGISTRY;
export type AgentId = (typeof ACTION_REGISTRY)[DomainName]["agentId"];
export type ActionName = {
  [K in DomainName]: keyof (typeof ACTION_REGISTRY)[K]["actions"];
}[DomainName];

type ActionEntry = ActionConfig & {
  domain: DomainName;
  agentId: AgentId;
  actionName: ActionName;
};

function isDomainName(value: string): value is DomainName {
  return Object.prototype.hasOwnProperty.call(ACTION_REGISTRY, value);
}

export function listDomains(): DomainName[] {
  return Object.keys(ACTION_REGISTRY).filter(isDomainName);
}

export function detectDomain(input: string): DomainName | null {
  const ranked = rankDomains(input);
  return ranked.length > 0 ? (ranked[0]!.domain as DomainName) : null;
}

export function getDomainConfig(domain: DomainName): DomainConfig {
  return ACTION_REGISTRY[domain];
}

export function getAgentByDomain(domain: DomainName): AgentId {
  return ACTION_REGISTRY[domain].agentId;
}

export function getActionsByDomain(domain: DomainName): ActionName[] {
  return Object.keys(ACTION_REGISTRY[domain].actions) as ActionName[];
}

export function getActionConfig(agentId: string, actionName: string): (ActionConfig & { domain: DomainName }) | null {
  for (const domain of listDomains()) {
    const cfg = ACTION_REGISTRY[domain];
    if (cfg.agentId === agentId && Object.prototype.hasOwnProperty.call(cfg.actions, actionName)) {
      const action = cfg.actions[actionName as keyof typeof cfg.actions] as ActionConfig;
      return { domain, ...action };
    }
  }
  return null;
}

export function getAllActionEntries(): ActionEntry[] {
  const items: ActionEntry[] = [];
  for (const domain of listDomains()) {
    const cfg = ACTION_REGISTRY[domain];
    for (const [actionName, actionCfg] of Object.entries(cfg.actions) as Array<
      [keyof typeof cfg.actions, (typeof cfg.actions)[keyof typeof cfg.actions]]
    >) {
      const config = actionCfg as ActionConfig;
      items.push({
        domain,
        agentId: cfg.agentId,
        actionName: actionName as ActionName,
        ...config
      });
    }
  }
  return items;
}

export function getDomainKeywords(domain: DomainName): readonly string[] {
  return KEYWORDS[domain] ?? [];
}

export function rankDomains(input: string): DomainRank[] {
  const lower = String(input ?? "").toLowerCase();
  if (!lower.trim()) return [];

  const rows: DomainRank[] = [];
  for (const domain of listDomains()) {
    const keywords = KEYWORDS[domain] ?? [];
    let score = 0;
    for (const keyword of keywords) {
      if (lower.includes(keyword)) score += keyword.length > 5 ? 1.25 : 1;
    }
    if (score > 0) rows.push({ domain, score });
  }

  rows.sort((a, b) => b.score - a.score || a.domain.localeCompare(b.domain));
  return rows;
}
