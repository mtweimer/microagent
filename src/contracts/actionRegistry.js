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
};

const KEYWORDS = {
  outlook: ["email", "outlook", "mail", "inbox", "reply", "send", "read", "latest"],
  calendar: ["calendar", "meeting", "schedule", "event", "invite"],
  teams: ["teams", "channel", "chat", "standup", "thread"],
  sharepoint: ["sharepoint", "site", "document library", "share point"],
  onedrive: ["onedrive", "file", "folder", "upload", "sync"]
};

export function listDomains() {
  return Object.keys(ACTION_REGISTRY);
}

export function detectDomain(input) {
  const ranked = rankDomains(input);
  return ranked.length > 0 ? ranked[0].domain : null;
}

export function getDomainConfig(domain) {
  return ACTION_REGISTRY[domain];
}

export function getAgentByDomain(domain) {
  return ACTION_REGISTRY[domain]?.agentId;
}

export function getActionsByDomain(domain) {
  return Object.keys(ACTION_REGISTRY[domain]?.actions ?? {});
}

export function getActionConfig(agentId, actionName) {
  for (const domain of listDomains()) {
    const cfg = ACTION_REGISTRY[domain];
    if (cfg.agentId === agentId && cfg.actions[actionName]) {
      return { domain, ...cfg.actions[actionName] };
    }
  }
  return null;
}

export function getAllActionEntries() {
  const items = [];
  for (const domain of listDomains()) {
    const cfg = ACTION_REGISTRY[domain];
    for (const [actionName, actionCfg] of Object.entries(cfg.actions)) {
      items.push({
        domain,
        agentId: cfg.agentId,
        actionName,
        ...actionCfg
      });
    }
  }
  return items;
}

export function getDomainKeywords(domain) {
  return [...(KEYWORDS[domain] ?? [])];
}

export function rankDomains(input) {
  const lower = String(input ?? "").toLowerCase();
  if (!lower.trim()) return [];

  const rows = [];
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
