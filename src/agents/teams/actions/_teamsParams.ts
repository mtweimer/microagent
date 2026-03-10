export type TeamsSurface = "chats" | "channels" | "both";
export type TeamsWindow = "today" | "48h" | "7d" | "30d" | "all";
export type TeamsDepth = "fast" | "balanced" | "deep" | "full";
export type TeamsImportance = "high" | "normal" | "";

export interface TeamsParams {
  query: string;
  top: number;
  surface: TeamsSurface;
  window: TeamsWindow;
  depth: TeamsDepth;
  team: string;
  channel: string;
  sender: string;
  since: string;
  until: string;
  importance: TeamsImportance;
}

export interface TeamsParamDefaults {
  top?: number;
  surface?: TeamsSurface;
  window?: TeamsWindow;
  depth?: TeamsDepth;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function clampTop(value: unknown, fallback = 25): number {
  const n = Number(value);
  if (Number.isNaN(n) || n < 1) return fallback;
  return Math.min(100, Math.floor(n));
}

function normalizeSurface(value: unknown, fallback: TeamsSurface = "both"): TeamsSurface {
  const lower = String(value ?? fallback).toLowerCase().trim();
  if (lower === "chats" || lower === "channels" || lower === "both") return lower;
  return fallback;
}

function normalizeWindow(value: unknown, fallback: TeamsWindow = "today"): TeamsWindow {
  const lower = String(value ?? fallback).toLowerCase().trim();
  if (lower === "today" || lower === "48h" || lower === "7d" || lower === "30d" || lower === "all") return lower;
  return fallback;
}

function normalizeDepth(value: unknown, fallback: TeamsDepth = "balanced"): TeamsDepth {
  const lower = String(value ?? fallback).toLowerCase().trim();
  if (lower === "fast" || lower === "balanced" || lower === "deep" || lower === "full") return lower;
  return fallback;
}

function normalizeTime(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

function normalizeImportance(value: unknown): TeamsImportance {
  const lower = String(value ?? "").toLowerCase().trim();
  if (lower === "high" || lower === "normal") return lower;
  return "";
}

export function normalizeTeamsParams(params: unknown = {}, defaults: TeamsParamDefaults = {}): TeamsParams {
  const record = asRecord(params);
  const team = typeof record.team === "string" ? record.team.trim() : "";
  const channel = typeof record.channel === "string" ? record.channel.trim() : "";
  const sender = typeof record.sender === "string" ? record.sender.trim() : "";
  const since = normalizeTime(record.since ?? "");
  const until = normalizeTime(record.until ?? "");
  const importance = normalizeImportance(record.importance ?? "");
  return {
    query: typeof record.query === "string" ? record.query.trim() : "",
    top: clampTop(record.top, defaults.top ?? 30),
    surface: normalizeSurface(record.surface, defaults.surface ?? "both"),
    window: normalizeWindow(record.window, defaults.window ?? "today"),
    depth: normalizeDepth(record.depth, defaults.depth ?? "balanced"),
    team,
    channel,
    sender,
    since,
    until,
    importance
  };
}
