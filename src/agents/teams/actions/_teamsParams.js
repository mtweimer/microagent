function clampTop(value, fallback = 25) {
  const n = Number(value);
  if (Number.isNaN(n) || n < 1) return fallback;
  return Math.min(100, Math.floor(n));
}

function normalizeSurface(value, fallback = "both") {
  const lower = String(value ?? fallback).toLowerCase().trim();
  if (lower === "chats" || lower === "channels" || lower === "both") return lower;
  return fallback;
}

function normalizeWindow(value, fallback = "today") {
  const lower = String(value ?? fallback).toLowerCase().trim();
  if (lower === "today" || lower === "48h" || lower === "7d" || lower === "30d" || lower === "all") return lower;
  return fallback;
}

function normalizeDepth(value, fallback = "balanced") {
  const lower = String(value ?? fallback).toLowerCase().trim();
  if (lower === "fast" || lower === "balanced" || lower === "deep" || lower === "full") return lower;
  return fallback;
}

function normalizeTime(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

function normalizeImportance(value) {
  const lower = String(value ?? "").toLowerCase().trim();
  if (lower === "high" || lower === "normal") return lower;
  return "";
}

export function normalizeTeamsParams(params = {}, defaults = {}) {
  const team = typeof params.team === "string" ? params.team.trim() : "";
  const channel = typeof params.channel === "string" ? params.channel.trim() : "";
  const sender = typeof params.sender === "string" ? params.sender.trim() : "";
  const since = normalizeTime(params.since ?? "");
  const until = normalizeTime(params.until ?? "");
  const importance = normalizeImportance(params.importance ?? "");
  return {
    query: typeof params.query === "string" ? params.query.trim() : "",
    top: clampTop(params.top, defaults.top ?? 30),
    surface: normalizeSurface(params.surface, defaults.surface ?? "both"),
    window: normalizeWindow(params.window, defaults.window ?? "today"),
    depth: normalizeDepth(params.depth, defaults.depth ?? "balanced"),
    team,
    channel,
    sender,
    since,
    until,
    importance
  };
}
