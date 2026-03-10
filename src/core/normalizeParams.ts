// @ts-nocheck
export function normalizeEnvelopeParams(envelope) {
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

function normalizeScheduleEventParams(params = {}) {
  const title = firstString(params.title, params.summary, params.subject, "New event");
  const when = normalizeWhen(params);
  const attendees = normalizeAttendees(params.attendees);

  return {
    title,
    when,
    attendees
  };
}

function normalizeFindEventsParams(params = {}) {
  const raw = firstString(params.timeRange, params.when, params.startDate, "upcoming").toLowerCase();
  let timeRange = raw;
  if (raw.includes("today")) timeRange = "today";
  else if (raw.includes("tomorrow")) timeRange = "tomorrow";
  else if (raw.includes("week")) timeRange = "this_week";
  else if (raw.includes("upcoming")) timeRange = "upcoming";

  return { timeRange };
}

function normalizeSendEmailParams(params = {}) {
  const to = normalizeAttendees(params.to ?? params.recipients);
  const subject = firstString(params.subject, "Drafted by dispatcher");
  const body = firstString(params.body, params.message, "");
  return { to, subject, body };
}

function normalizeListRecentEmailsParams(params = {}) {
  const limitRaw = Number(params.limit ?? 5);
  const limit = Number.isNaN(limitRaw) ? 5 : Math.min(50, Math.max(1, Math.floor(limitRaw)));
  const folder = firstString(params.folder, params.mailFolder);
  return folder ? { limit, folder } : { limit };
}

function normalizeReadEmailParams(params = {}) {
  const idRaw = firstString(params.id, params.messageId, params.emailId);
  const referenceRaw = firstString(params.reference, params.which, "latest");
  const idIsReference = isReferenceAlias(idRaw);
  const id = idIsReference ? null : idRaw;
  const reference = idIsReference ? normalizeReferenceAlias(idRaw) : normalizeReferenceAlias(referenceRaw);
  const out = {};
  if (id) out.id = id;
  if (reference) out.reference = reference;
  return out;
}

function normalizeTeamsSearchParams(params = {}) {
  const query = firstString(params.query, params.text, params.term, "");
  const team = firstString(params.team, params.teamName, params.workspace, "");
  const channel = firstString(params.channel, params.channelName, "");
  const top = clampLimit(params.top, 30);
  const surface = normalizeTeamsSurface(params.surface);
  const window = normalizeTeamsWindow(params.window);
  const depth = normalizeTeamsDepth(params.depth);
  const out = { query, top, surface, window, depth };
  if (team) out.team = team;
  if (channel) out.channel = channel;
  return out;
}

function normalizeTeamsTopParams(params = {}) {
  return {
    top: clampLimit(params.top, 30),
    surface: normalizeTeamsSurface(params.surface),
    window: normalizeTeamsWindow(params.window),
    depth: normalizeTeamsDepth(params.depth)
  };
}

function normalizeTeamsReadParams(params = {}) {
  const id = firstString(params.id, params.messageId);
  return id ? { id } : {};
}

function normalizeAttendees(value) {
  if (!Array.isArray(value)) return [];

  const emails = [];
  for (const item of value) {
    if (typeof item === "string") {
      if (isEmail(item)) emails.push(item.toLowerCase());
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const candidate =
      firstString(item.email, item.address, item.recipient, item.userPrincipalName) ??
      firstString(item.emailAddress?.address);
    if (candidate && isEmail(candidate)) emails.push(candidate.toLowerCase());
  }

  return [...new Set(emails)];
}

function normalizeWhen(params = {}) {
  if (typeof params.when === "string" && params.when.trim()) return params.when.trim();

  const fromStart = params.start?.dateTime;
  if (typeof fromStart === "string" && fromStart.trim()) return fromStart.trim();

  return "unspecified";
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? "").trim());
}

function clampLimit(value, fallback) {
  const n = Number(value);
  if (Number.isNaN(n) || n < 1) return fallback;
  return Math.min(100, Math.floor(n));
}

function normalizeTeamsSurface(value) {
  const lower = String(value ?? "both").toLowerCase().trim();
  if (lower === "chats" || lower === "channels" || lower === "both") return lower;
  return "both";
}

function normalizeTeamsWindow(value) {
  const lower = String(value ?? "today").toLowerCase().trim();
  if (lower === "today" || lower === "48h" || lower === "7d" || lower === "30d" || lower === "all") return lower;
  return "today";
}

function normalizeTeamsDepth(value) {
  const lower = String(value ?? "balanced").toLowerCase().trim();
  if (lower === "fast" || lower === "balanced" || lower === "deep") return lower;
  return "balanced";
}

function isReferenceAlias(value) {
  const lower = String(value ?? "").toLowerCase().trim();
  return lower === "latest" || lower === "last" || lower === "recent" || lower === "previous";
}

function normalizeReferenceAlias(value) {
  const lower = String(value ?? "").toLowerCase().trim();
  if (lower === "last" || lower === "recent") return "latest";
  if (lower === "previous") return "previous";
  if (lower) return lower;
  return null;
}
