import type { ActionEnvelope, AnyRecord } from "./contracts.js";

function asRecord(value: unknown): AnyRecord {
  return typeof value === "object" && value !== null ? (value as AnyRecord) : {};
}

export function normalizeEnvelopeParams(envelope: ActionEnvelope | null | undefined): ActionEnvelope | null | undefined {
  if (!envelope || typeof envelope !== "object") return envelope;

  if (envelope.agent === "ms.calendar" && envelope.action === "schedule_event") {
    return {
      ...envelope,
      params: normalizeScheduleEventParams(envelope.params)
    };
  }

  if (envelope.agent === "ms.calendar" && envelope.action === "find_events") {
    return {
      ...envelope,
      params: normalizeFindEventsParams(envelope.params)
    };
  }

  if (envelope.agent === "ms.outlook" && envelope.action === "send_email") {
    return {
      ...envelope,
      params: normalizeSendEmailParams(envelope.params)
    };
  }

  if (envelope.agent === "ms.outlook" && envelope.action === "list_recent_emails") {
    return {
      ...envelope,
      params: normalizeListRecentEmailsParams(envelope.params)
    };
  }

  if (envelope.agent === "ms.outlook" && envelope.action === "read_email") {
    return {
      ...envelope,
      params: normalizeReadEmailParams(envelope.params)
    };
  }

  if (envelope.agent === "ms.teams" && envelope.action === "search_messages") {
    return {
      ...envelope,
      params: normalizeTeamsSearchParams(envelope.params)
    };
  }

  if (envelope.agent === "ms.teams" && envelope.action === "read_message") {
    return {
      ...envelope,
      params: normalizeTeamsReadParams(envelope.params)
    };
  }

  if (
    envelope.agent === "ms.teams" &&
    (envelope.action === "review_my_day" || envelope.action === "search_mentions")
  ) {
    return {
      ...envelope,
      params: normalizeTeamsTopParams(envelope.params)
    };
  }

  return envelope;
}

function normalizeScheduleEventParams(params: unknown = {}): AnyRecord {
  const typed = asRecord(params);
  const title = firstString(typed.title, typed.summary, typed.subject, "New event") ?? "New event";
  const when = normalizeWhen(typed);
  const attendees = normalizeAttendees(typed.attendees);

  return { title, when, attendees };
}

function normalizeFindEventsParams(params: unknown = {}): AnyRecord {
  const typed = asRecord(params);
  const raw = (firstString(typed.timeRange, typed.when, typed.startDate, "upcoming") ?? "upcoming").toLowerCase();
  let timeRange = raw;
  if (raw.includes("today")) timeRange = "today";
  else if (raw.includes("tomorrow")) timeRange = "tomorrow";
  else if (raw.includes("week")) timeRange = "this_week";
  else if (raw.includes("upcoming")) timeRange = "upcoming";

  return { timeRange };
}

function normalizeSendEmailParams(params: unknown = {}): AnyRecord {
  const typed = asRecord(params);
  const to = normalizeAttendees(typed.to ?? typed.recipients);
  const subject = firstString(typed.subject, "Drafted by dispatcher") ?? "Drafted by dispatcher";
  const body = firstString(typed.body, typed.message, "") ?? "";
  return { to, subject, body };
}

function normalizeListRecentEmailsParams(params: unknown = {}): AnyRecord {
  const typed = asRecord(params);
  const limitRaw = Number(typed.limit ?? 5);
  const limit = Number.isNaN(limitRaw) ? 5 : Math.min(50, Math.max(1, Math.floor(limitRaw)));
  const folder = firstString(typed.folder, typed.mailFolder);
  return folder ? { limit, folder } : { limit };
}

function normalizeReadEmailParams(params: unknown = {}): AnyRecord {
  const typed = asRecord(params);
  const idRaw = firstString(typed.id, typed.messageId, typed.emailId);
  const referenceRaw = firstString(typed.reference, typed.which, "latest");
  const idIsReference = isReferenceAlias(idRaw);
  const id = idIsReference ? null : idRaw;
  const reference = idIsReference ? normalizeReferenceAlias(idRaw) : normalizeReferenceAlias(referenceRaw);
  const out: AnyRecord = {};
  if (id) out.id = id;
  if (reference) out.reference = reference;
  return out;
}

function normalizeTeamsSearchParams(params: unknown = {}): AnyRecord {
  const typed = asRecord(params);
  const query = firstString(typed.query, typed.text, typed.term, "") ?? "";
  const team = firstString(typed.team, typed.teamName, typed.workspace, "");
  const channel = firstString(typed.channel, typed.channelName, "");
  const top = clampLimit(typed.top, 30);
  const surface = normalizeTeamsSurface(typed.surface);
  const window = normalizeTeamsWindow(typed.window);
  const depth = normalizeTeamsDepth(typed.depth);
  const out: AnyRecord = { query, top, surface, window, depth };
  if (team) out.team = team;
  if (channel) out.channel = channel;
  return out;
}

function normalizeTeamsTopParams(params: unknown = {}): AnyRecord {
  const typed = asRecord(params);
  return {
    top: clampLimit(typed.top, 30),
    surface: normalizeTeamsSurface(typed.surface),
    window: normalizeTeamsWindow(typed.window),
    depth: normalizeTeamsDepth(typed.depth)
  };
}

function normalizeTeamsReadParams(params: unknown = {}): AnyRecord {
  const typed = asRecord(params);
  const id = firstString(typed.id, typed.messageId);
  return id ? { id } : {};
}

function normalizeAttendees(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const emails: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      if (isEmail(item)) emails.push(item.toLowerCase());
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const typed = item as AnyRecord;
    const emailAddress = asRecord(typed.emailAddress);
    const candidate =
      firstString(typed.email, typed.address, typed.recipient, typed.userPrincipalName) ??
      firstString(emailAddress.address);
    if (candidate && isEmail(candidate)) emails.push(candidate.toLowerCase());
  }

  return [...new Set(emails)];
}

function normalizeWhen(params: AnyRecord = {}): string {
  if (typeof params.when === "string" && params.when.trim()) return params.when.trim();

  const start = asRecord(params.start);
  const fromStart = start.dateTime;
  if (typeof fromStart === "string" && fromStart.trim()) return fromStart.trim();

  return "unspecified";
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function isEmail(value: unknown): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? "").trim());
}

function clampLimit(value: unknown, fallback: number): number {
  const n = Number(value);
  if (Number.isNaN(n) || n < 1) return fallback;
  return Math.min(100, Math.floor(n));
}

function normalizeTeamsSurface(value: unknown): "chats" | "channels" | "both" {
  const lower = String(value ?? "both").toLowerCase().trim();
  if (lower === "chats" || lower === "channels" || lower === "both") return lower;
  return "both";
}

function normalizeTeamsWindow(value: unknown): "today" | "48h" | "7d" | "30d" | "all" {
  const lower = String(value ?? "today").toLowerCase().trim();
  if (lower === "today" || lower === "48h" || lower === "7d" || lower === "30d" || lower === "all") return lower;
  return "today";
}

function normalizeTeamsDepth(value: unknown): "fast" | "balanced" | "deep" {
  const lower = String(value ?? "balanced").toLowerCase().trim();
  if (lower === "fast" || lower === "balanced" || lower === "deep") return lower;
  return "balanced";
}

function isReferenceAlias(value: unknown): boolean {
  const lower = String(value ?? "").toLowerCase().trim();
  return lower === "latest" || lower === "last" || lower === "recent" || lower === "previous";
}

function normalizeReferenceAlias(value: unknown): string | null {
  const lower = String(value ?? "").toLowerCase().trim();
  if (lower === "last" || lower === "recent") return "latest";
  if (lower === "previous") return "previous";
  if (lower) return lower;
  return null;
}
