export function deriveRetrievalPlan({ input, routeDecision, envelope, executionResult }) {
  if (!envelope || !routeDecision) return null;
  if (routeDecision.mode !== "retrieval") return null;

  if (envelope.agent === "ms.outlook" && envelope.action === "search_email") {
    const mode = executionResult?.artifacts?.searchMode ?? inferOutlookQueryMode(input);
    return {
      domain: "outlook",
      action: "search_email",
      queryMode: mode,
      limit: inferLimit(input),
      constraints: {
        query: envelope.params?.query ?? "",
        unreadOnly: mode.includes("unread"),
        timeWindow: mode.includes("today") ? "today" : "any"
      }
    };
  }

  if (envelope.agent === "ms.outlook" && envelope.action === "list_recent_emails") {
    const limit = Number(envelope.params?.limit ?? inferLimit(input));
    return {
      domain: "outlook",
      action: "list_recent_emails",
      queryMode: "top_n_recent",
      limit: Number.isNaN(limit) ? 5 : Math.max(1, Math.min(50, limit)),
      constraints: {
        folder: envelope.params?.folder ?? "inbox"
      }
    };
  }

  if (envelope.agent === "ms.outlook" && envelope.action === "read_email") {
    return {
      domain: "outlook",
      action: "read_email",
      queryMode: "by_id_or_reference",
      limit: 1,
      constraints: {
        id: envelope.params?.id ?? null,
        reference: envelope.params?.reference ?? null
      }
    };
  }

  if (envelope.agent === "ms.calendar" && envelope.action === "find_events") {
    const range = String(envelope.params?.timeRange ?? "upcoming");
    return {
      domain: "calendar",
      action: "find_events",
      queryMode: "calendar_range",
      limit: 25,
      constraints: {
        timeRange: range
      }
    };
  }

  if (envelope.agent === "ms.teams" && envelope.action === "search_messages") {
    return {
      domain: "teams",
      action: "search_messages",
      queryMode: "multi_surface_filter",
      limit: Number(envelope.params?.top ?? 25),
      constraints: {
        query: envelope.params?.query ?? "",
        surface: envelope.params?.surface ?? "both",
        window: envelope.params?.window ?? "30d",
        depth: envelope.params?.depth ?? "balanced"
      }
    };
  }

  if (envelope.agent === "ms.teams" && envelope.action === "review_my_day") {
    return {
      domain: "teams",
      action: "review_my_day",
      queryMode: "multi_surface_review",
      limit: Number(envelope.params?.top ?? 30),
      constraints: {
        surface: envelope.params?.surface ?? "both",
        window: envelope.params?.window ?? "today",
        depth: envelope.params?.depth ?? "balanced"
      }
    };
  }

  if (envelope.agent === "ms.teams" && envelope.action === "search_mentions") {
    return {
      domain: "teams",
      action: "search_mentions",
      queryMode: "mention_like_filter",
      limit: Number(envelope.params?.top ?? 30),
      constraints: {
        surface: envelope.params?.surface ?? "both",
        window: envelope.params?.window ?? "today",
        depth: envelope.params?.depth ?? "balanced"
      }
    };
  }

  if (envelope.agent === "ms.teams" && envelope.action === "read_message") {
    return {
      domain: "teams",
      action: "read_message",
      queryMode: "by_id",
      limit: 1,
      constraints: {
        id: envelope.params?.id ?? null
      }
    };
  }

  return null;
}

function inferOutlookQueryMode(input) {
  const lower = String(input ?? "").toLowerCase();
  if (lower.includes("unread") && lower.includes("today")) return "filter_unread_today";
  if (lower.includes("unread")) return "filter_unread";
  if (lower.includes("today")) return "filter_today";
  if (lower.includes("latest") || lower.includes("recent") || lower.includes("last ")) return "top_n_recent";
  return "search";
}

function inferLimit(input) {
  const lower = String(input ?? "").toLowerCase();
  const m = lower.match(/\b(?:last|latest)\s+(\d{1,2})\b/);
  if (!m) return 10;
  const n = Number(m[1]);
  if (Number.isNaN(n) || n < 1) return 10;
  return Math.min(50, n);
}
