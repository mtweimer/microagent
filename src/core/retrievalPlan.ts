import type { ActionEnvelope, AgentExecutionResult, AnyRecord, RouteDecision } from "./contracts.js";

interface RetrievalPlan {
  domain: string;
  action: string;
  queryMode: string;
  limit: number;
  constraints: AnyRecord;
}

interface RetrievalPlanInput {
  input: string;
  routeDecision: RouteDecision | null | undefined;
  envelope: ActionEnvelope | null | undefined;
  executionResult: AgentExecutionResult | null | undefined;
}

export function deriveRetrievalPlan({
  input,
  routeDecision,
  envelope,
  executionResult
}: RetrievalPlanInput): RetrievalPlan | null {
  if (!envelope || !routeDecision || routeDecision.mode !== "retrieval") return null;

  if (envelope.agent === "ms.outlook" && envelope.action === "search_email") {
    const artifacts = executionResult?.artifacts ?? {};
    const mode = typeof artifacts.searchMode === "string" ? artifacts.searchMode : inferOutlookQueryMode(input);
    return {
      domain: "outlook",
      action: "search_email",
      queryMode: mode,
      limit: inferLimit(input),
      constraints: {
        query: typeof envelope.params.query === "string" ? envelope.params.query : "",
        unreadOnly: mode.includes("unread"),
        timeWindow: mode.includes("today") ? "today" : "any"
      }
    };
  }

  if (envelope.agent === "ms.outlook" && envelope.action === "list_recent_emails") {
    const parsedLimit = Number(envelope.params.limit ?? inferLimit(input));
    const limit = Number.isNaN(parsedLimit) ? 5 : Math.max(1, Math.min(50, parsedLimit));
    return {
      domain: "outlook",
      action: "list_recent_emails",
      queryMode: "top_n_recent",
      limit,
      constraints: {
        folder: typeof envelope.params.folder === "string" ? envelope.params.folder : "inbox"
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
        id: typeof envelope.params.id === "string" ? envelope.params.id : null,
        reference: typeof envelope.params.reference === "string" ? envelope.params.reference : null
      }
    };
  }

  if (envelope.agent === "ms.calendar" && envelope.action === "find_events") {
    const range = typeof envelope.params.timeRange === "string" ? envelope.params.timeRange : "upcoming";
    return {
      domain: "calendar",
      action: "find_events",
      queryMode: "calendar_range",
      limit: 25,
      constraints: { timeRange: range }
    };
  }

  if (envelope.agent === "ms.teams" && envelope.action === "search_messages") {
    return {
      domain: "teams",
      action: "search_messages",
      queryMode: "multi_surface_filter",
      limit: Number(envelope.params.top ?? 25),
      constraints: {
        query: typeof envelope.params.query === "string" ? envelope.params.query : "",
        surface: typeof envelope.params.surface === "string" ? envelope.params.surface : "both",
        window: typeof envelope.params.window === "string" ? envelope.params.window : "30d",
        depth: typeof envelope.params.depth === "string" ? envelope.params.depth : "balanced"
      }
    };
  }

  if (envelope.agent === "ms.teams" && envelope.action === "review_my_day") {
    return {
      domain: "teams",
      action: "review_my_day",
      queryMode: "multi_surface_review",
      limit: Number(envelope.params.top ?? 30),
      constraints: {
        surface: typeof envelope.params.surface === "string" ? envelope.params.surface : "both",
        window: typeof envelope.params.window === "string" ? envelope.params.window : "today",
        depth: typeof envelope.params.depth === "string" ? envelope.params.depth : "balanced"
      }
    };
  }

  if (envelope.agent === "ms.teams" && envelope.action === "search_mentions") {
    return {
      domain: "teams",
      action: "search_mentions",
      queryMode: "mention_like_filter",
      limit: Number(envelope.params.top ?? 30),
      constraints: {
        surface: typeof envelope.params.surface === "string" ? envelope.params.surface : "both",
        window: typeof envelope.params.window === "string" ? envelope.params.window : "today",
        depth: typeof envelope.params.depth === "string" ? envelope.params.depth : "balanced"
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
        id: typeof envelope.params.id === "string" ? envelope.params.id : null
      }
    };
  }

  return null;
}

function inferOutlookQueryMode(input: string): string {
  const lower = String(input ?? "").toLowerCase();
  if (lower.includes("unread") && lower.includes("today")) return "filter_unread_today";
  if (lower.includes("unread")) return "filter_unread";
  if (lower.includes("today")) return "filter_today";
  if (lower.includes("latest") || lower.includes("recent") || lower.includes("last ")) return "top_n_recent";
  return "search";
}

function inferLimit(input: string): number {
  const lower = String(input ?? "").toLowerCase();
  const match = lower.match(/\b(?:last|latest)\s+(\d{1,2})\b/);
  if (!match) return 10;
  const parsed = Number(match[1]);
  if (Number.isNaN(parsed) || parsed < 1) return 10;
  return Math.min(50, parsed);
}
