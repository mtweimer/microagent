import crypto from "node:crypto";
import type { ActionEnvelope, AnyRecord } from "./contracts.js";

function mkEnvelope(agent: string, action: string, params: AnyRecord, confidence = 0.8): ActionEnvelope {
  return {
    requestId: crypto.randomUUID(),
    schemaVersion: "1.0.0",
    agent,
    action,
    params,
    confidence,
    requiresConfirmation: false
  };
}

export function translateHeuristic(input: string, domain: string): ActionEnvelope {
  const lower = input.toLowerCase();
  const hasReadVerb = /\bread\b/.test(lower);
  const emailObject = lower.includes("email") || lower.includes("inbox") || lower.includes("message");
  const implicitEmailRef =
    lower.includes("latest one") ||
    lower.includes("last one") ||
    lower.includes("read it") ||
    lower.includes("that one") ||
    lower.includes("that email");
  const emailTarget = emailObject || implicitEmailRef;
  const retrievalVerb =
    lower.includes("fetch") ||
    lower.includes("get") ||
    lower.includes("retrieve") ||
    lower.includes("list");
  const latestHint = lower.includes("latest") || lower.includes("last") || lower.includes("recent");
  const emailFollowUpQuestion = isEmailFollowUpQuestion(lower);

  if (domain === "calendar") {
    if (lower.includes("schedule") || lower.includes("create") || lower.includes("set up")) {
      return mkEnvelope("ms.calendar", "schedule_event", {
        title: input,
        when: lower.includes("tomorrow") ? "tomorrow" : "unspecified",
        attendees: []
      });
    }
    return mkEnvelope("ms.calendar", "find_events", {
      timeRange: lower.includes("today") ? "today" : "upcoming"
    });
  }

  if (domain === "outlook") {
    if (emailFollowUpQuestion) {
      return mkEnvelope("ms.outlook", "read_email", { reference: "latest" }, 0.86);
    }
    if (lower.includes("summarize") && emailTarget) {
      return mkEnvelope("ms.outlook", "read_email", { reference: "latest" }, 0.84);
    }
    if (hasReadVerb && implicitEmailRef) {
      return mkEnvelope("ms.outlook", "read_email", { reference: "latest" }, 0.86);
    }
    if (hasReadVerb && emailTarget && latestHint) {
      return mkEnvelope("ms.outlook", "read_email", { reference: "latest" }, 0.87);
    }
    if (retrievalVerb && emailTarget && latestHint) {
      const limit = extractTopN(lower) ?? 5;
      return mkEnvelope("ms.outlook", "list_recent_emails", { limit }, 0.85);
    }
    if (hasReadVerb && emailTarget) {
      return mkEnvelope("ms.outlook", "read_email", { reference: "latest" }, 0.8);
    }
    if (lower.includes("search") || lower.includes("find") || (retrievalVerb && emailTarget)) {
      return mkEnvelope("ms.outlook", "search_email", { query: input });
    }
    if (lower.includes("send") || lower.includes("reply") || lower.includes("compose") || lower.includes("draft")) {
      return mkEnvelope("ms.outlook", "send_email", {
        to: [],
        subject: "Drafted by dispatcher",
        body: input
      });
    }
    return mkEnvelope("ms.outlook", "search_email", { query: input });
  }

  if (domain === "teams") {
    const explicitSearch = lower.includes("search") || lower.includes("find");
    const teamsDirectives = parseTeamsDirectives(lower);
    if (lower.includes("mention") || lower.includes("respond")) {
      return mkEnvelope(
        "ms.teams",
        "search_mentions",
        {
          top: teamsDirectives.top ?? 30,
          surface: teamsDirectives.surface ?? "both",
          window: teamsDirectives.window ?? "today",
          depth: teamsDirectives.depth ?? "balanced"
        },
        0.78
      );
    }
    if (explicitSearch) {
      const query = extractTeamsSearchQuery(input);
      return mkEnvelope(
        "ms.teams",
        "search_messages",
        {
          query,
          top: teamsDirectives.top ?? 30,
          surface: teamsDirectives.surface ?? "both",
          window: teamsDirectives.window ?? (lower.includes("today") ? "today" : "30d"),
          depth: teamsDirectives.depth ?? "balanced",
          team: teamsDirectives.team ?? "",
          channel: teamsDirectives.channel ?? ""
        },
        0.72
      );
    }
    if (lower.includes("miss") || lower.includes("today") || lower.includes("review")) {
      return mkEnvelope(
        "ms.teams",
        "review_my_day",
        {
          top: teamsDirectives.top ?? 30,
          surface: teamsDirectives.surface ?? "both",
          window: teamsDirectives.window ?? "today",
          depth: teamsDirectives.depth ?? "balanced"
        },
        0.78
      );
    }
    return mkEnvelope(
      "ms.teams",
      "search_messages",
      {
        query: extractTeamsSearchQuery(input),
        top: teamsDirectives.top ?? 30,
        surface: teamsDirectives.surface ?? "both",
        window: teamsDirectives.window ?? "30d",
        depth: teamsDirectives.depth ?? "balanced",
        team: teamsDirectives.team ?? "",
        channel: teamsDirectives.channel ?? ""
      },
      0.65
    );
  }

  if (domain === "sharepoint") {
    return mkEnvelope("ms.sharepoint", "search_documents", { query: input }, 0.65);
  }

  if (domain === "onedrive") {
    return mkEnvelope("ms.onedrive", "search_files", { query: input }, 0.65);
  }

  return mkEnvelope("dispatcher", "clarify", { text: input }, 0.4);
}

function extractTopN(lower: string): number | null {
  const m = lower.match(/\b(?:last|latest)\s+(\d{1,2})\b/);
  if (!m) return null;
  const n = Number(m[1]);
  if (Number.isNaN(n) || n < 1) return null;
  return Math.min(50, n);
}

function isEmailFollowUpQuestion(lower: string): boolean {
  if (!lower.includes("?")) return false;
  return (
    lower.includes("what did they want") ||
    lower.includes("what was it about") ||
    lower.includes("is it important") ||
    lower.includes("was it important") ||
    lower.includes("what did it say")
  );
}

function parseTeamsDirectives(lower: string): AnyRecord {
  const out: AnyRecord = {};
  const top = lower.match(/\btop\s*=\s*(\d{1,3})\b/);
  if (top) out.top = Math.max(1, Math.min(100, Number(top[1])));
  const surface = lower.match(/\bsurface\s*=\s*(chats|channels|both)\b/);
  if (surface) out.surface = surface[1];
  const window = lower.match(/\bwindow\s*=\s*(today|48h|7d|30d|all)\b/);
  if (window) out.window = window[1];
  const depth = lower.match(/\bdepth\s*=\s*(fast|balanced|deep)\b/);
  if (depth) out.depth = depth[1];
  const team = lower.match(/\bteam\s*=\s*([^\s]+)/);
  if (team?.[1]) out.team = decodeDirectiveValue(team[1]);
  const channel = lower.match(/\bchannel\s*=\s*([^\s]+)/);
  if (channel?.[1]) out.channel = decodeDirectiveValue(channel[1]);
  return out;
}

function extractTeamsSearchQuery(input: string): string {
  let text = String(input ?? "").trim();
  text = text.replace(/\b(?:window|surface|depth|top|team|channel)\s*=\s*[^\s]+/gi, " ").replace(/\s+/g, " ").trim();
  text = text.replace(/^search\s+teams\s+for\s+/i, "");
  text = text.replace(/^find\s+teams\s+for\s+/i, "");
  text = text.replace(/^search\s+for\s+/i, "");
  text = text.trim();
  return text || String(input ?? "").trim();
}

function decodeDirectiveValue(value: string): string {
  return String(value ?? "")
    .replace(/^['"]|['"]$/g, "")
    .replace(/_/g, " ")
    .trim();
}
