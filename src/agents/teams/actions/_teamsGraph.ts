import type { GraphClientLike } from "../../../core/contracts.js";
import type { TeamsDepth, TeamsImportance, TeamsParams, TeamsSurface, TeamsWindow } from "./_teamsParams.js";

type NullableString = string | null;

interface TeamsGraphUserIdentity {
  displayName?: string;
}

interface TeamsGraphApplicationIdentity {
  displayName?: string;
}

interface TeamsGraphFrom {
  user?: TeamsGraphUserIdentity;
  application?: TeamsGraphApplicationIdentity;
}

interface TeamsGraphMention {
  mentionText?: string;
}

interface TeamsGraphAttachment {
  name?: string;
}

interface TeamsGraphBody {
  content?: string;
}

interface TeamsGraphMessage {
  id?: string;
  createdDateTime?: string;
  importance?: string;
  webUrl?: string;
  subject?: string;
  summary?: string;
  bodyPreview?: string;
  body?: TeamsGraphBody;
  mentions?: TeamsGraphMention[];
  attachments?: TeamsGraphAttachment[];
  from?: TeamsGraphFrom;
}

interface TeamsGraphChat {
  id?: string;
  topic?: string;
  webUrl?: string;
}

interface TeamsGraphChannel {
  id?: string;
  displayName?: string;
  webUrl?: string;
}

interface TeamsGraphTeam {
  id?: string;
  displayName?: string;
  webUrl?: string;
}

interface GraphCollection<T> {
  value?: T[];
}

interface FailureState {
  failures: number;
  lastFailureAt: number;
}

interface DepthConfig {
  maxChats: number;
  perChat: number;
  maxTeams: number;
  maxChannelsPerTeam: number;
  perChannel: number;
}

interface AdvancedFilters {
  sender?: string;
  since?: string;
  until?: string;
  importance?: TeamsImportance | string;
}

export interface TeamsMessageRow {
  id: string;
  sourceType: "chat" | "channel";
  sourcePath: NullableString;
  from: string;
  createdDateTime: NullableString;
  importance: string;
  webUrl: NullableString;
  subject: NullableString;
  summary: NullableString;
  bodyPreview: string;
  mentions: string[];
  attachmentNames: string[];
  chatId: NullableString;
  chatTopic: NullableString;
  teamId: NullableString;
  teamName: NullableString;
  channelId: NullableString;
  channelName: NullableString;
}

export interface TeamsCatalogRow {
  id: NullableString;
  label: string;
  webUrl: NullableString;
  teamId?: NullableString;
  teamName?: NullableString;
  channelId?: NullableString;
  channelName?: NullableString;
}

interface TeamsCatalog {
  chats: TeamsCatalogRow[];
  teams: TeamsCatalogRow[];
  channels: TeamsCatalogRow[];
}

interface ChatCoverage {
  chatsScanned: number;
  chatMessagesScanned: number;
}

interface ChannelCoverage {
  teamsScanned: number;
  channelsScanned: number;
  channelMessagesScanned: number;
}

export interface FetchCoverage extends ChatCoverage, ChannelCoverage {
  totalCandidates: number;
}

interface ChatCollectionResult {
  rows: TeamsMessageRow[];
  sources: string[];
  limitations: string[];
  coverage: ChatCoverage;
  catalog: Pick<TeamsCatalog, "chats">;
}

interface ChannelCollectionResult {
  rows: TeamsMessageRow[];
  sources: string[];
  limitations: string[];
  coverage: ChannelCoverage;
  catalog: Pick<TeamsCatalog, "teams" | "channels">;
}

export interface TeamsFetchResult {
  messages: TeamsMessageRow[];
  sources: string[];
  coverage: FetchCoverage;
  limitations: string[];
  catalog: TeamsCatalog;
}

interface ProbeResult<T = unknown> {
  ok: boolean;
  endpoint?: string;
  count?: number | null;
  data?: T;
  error?: string | null;
  skipped?: boolean;
  empty?: boolean;
  reason?: string | null;
}

interface TeamsProbeResult {
  chats: ProbeResult<GraphCollection<TeamsGraphChat>>;
  chatMessages: ProbeResult<GraphCollection<TeamsGraphMessage>>;
  joinedTeams: ProbeResult<GraphCollection<TeamsGraphTeam>>;
  channels: ProbeResult<GraphCollection<TeamsGraphChannel>>;
  channelMessages: ProbeResult<GraphCollection<TeamsGraphMessage>>;
}

const CHAT_FAILURE_TRACKER = new Map<string, FailureState>();
const CHAT_BACKOFF_MS = 10 * 60 * 1000;
const CHAT_FAILURE_THRESHOLD = 2;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asCollection<T>(value: unknown): GraphCollection<T> {
  const record = asRecord(value);
  return Array.isArray(record.value) ? ({ ...record, value: record.value as T[] } as GraphCollection<T>) : ({ ...record, value: [] } as GraphCollection<T>);
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function depthConfig(depth: TeamsDepth | string = "balanced"): DepthConfig {
  const key = String(depth ?? "balanced").toLowerCase();
  if (key === "full") {
    return { maxChats: 50, perChat: 50, maxTeams: 100, maxChannelsPerTeam: 20, perChannel: 25 };
  }
  if (key === "fast") {
    return { maxChats: 8, perChat: 2, maxTeams: 4, maxChannelsPerTeam: 2, perChannel: 3 };
  }
  if (key === "deep") {
    return { maxChats: 30, perChat: 8, maxTeams: 20, maxChannelsPerTeam: 8, perChannel: 10 };
  }
  return { maxChats: 15, perChat: 4, maxTeams: 10, maxChannelsPerTeam: 4, perChannel: 5 };
}

function windowStart(window: TeamsWindow | string = "today"): Date | null {
  const now = new Date();
  const key = String(window ?? "today").toLowerCase();
  if (key === "all") return null;
  if (key === "30d") return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (key === "7d") return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (key === "48h") return new Date(now.getTime() - 48 * 60 * 60 * 1000);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}

function toDate(value: unknown): Date | null {
  const raw = typeof value === "string" || typeof value === "number" || value instanceof Date ? value : 0;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function isWithinWindow(value: unknown, since: Date | null): boolean {
  if (!since) return true;
  const d = toDate(value);
  if (!d) return false;
  return d.getTime() >= since.getTime();
}

function fromDisplayName(raw: TeamsGraphMessage): string {
  return raw.from?.user?.displayName ?? raw.from?.application?.displayName ?? "unknown";
}

function stripHtml(value: unknown): string {
  const text = String(value ?? "");
  return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function tokenizeQuery(value: unknown): string[] {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function nameScore(value: unknown, queryTokens: string[]): number {
  const lower = String(value ?? "").toLowerCase();
  if (!lower || queryTokens.length === 0) return 0;
  let hits = 0;
  for (const token of queryTokens) {
    if (lower.includes(token)) hits += 1;
  }
  if (hits === 0) return 0;
  return hits === queryTokens.length ? 10 + hits : hits;
}

function prioritizeByQuery<T>(rows: T[], toName: (row: T) => string, queryTokens: string[]): T[] {
  if (!Array.isArray(rows) || queryTokens.length === 0) return rows ?? [];
  return [...rows].sort((a, b) => {
    const sa = nameScore(toName(a), queryTokens);
    const sb = nameScore(toName(b), queryTokens);
    if (sb !== sa) return sb - sa;
    return String(toName(a)).localeCompare(String(toName(b)));
  });
}

function shouldSkipChat(chatId: string): boolean {
  const state = CHAT_FAILURE_TRACKER.get(chatId);
  if (!state) return false;
  if (state.failures < CHAT_FAILURE_THRESHOLD) return false;
  return Date.now() - state.lastFailureAt < CHAT_BACKOFF_MS;
}

function markChatFailure(chatId: string): void {
  const current = CHAT_FAILURE_TRACKER.get(chatId) ?? { failures: 0, lastFailureAt: 0 };
  CHAT_FAILURE_TRACKER.set(chatId, { failures: current.failures + 1, lastFailureAt: Date.now() });
}

function clearChatFailure(chatId: string): void {
  CHAT_FAILURE_TRACKER.delete(chatId);
}

function scopeMatch(value: unknown, filter: unknown): boolean {
  const v = String(value ?? "").toLowerCase().trim();
  const f = String(filter ?? "").toLowerCase().trim();
  if (!f) return true;
  return v.includes(f);
}

function inTeamScope(team: TeamsGraphTeam, teamFilter: string): boolean {
  if (!teamFilter) return true;
  return scopeMatch(team.displayName, teamFilter) || String(team.id ?? "").toLowerCase() === String(teamFilter).toLowerCase();
}

function inChannelScope(channel: TeamsGraphChannel, channelFilter: string): boolean {
  if (!channelFilter) return true;
  return scopeMatch(channel.displayName, channelFilter) || String(channel.id ?? "").toLowerCase() === String(channelFilter).toLowerCase();
}

function inTimeRange(value: unknown, sinceIso: string, untilIso: string): boolean {
  const d = toDate(value);
  if (!d) return false;
  if (sinceIso) {
    const since = toDate(sinceIso);
    if (since && d.getTime() < since.getTime()) return false;
  }
  if (untilIso) {
    const until = toDate(untilIso);
    if (until && d.getTime() > until.getTime()) return false;
  }
  return true;
}

function matchesAdvancedFilters(msg: TeamsMessageRow, { sender = "", since = "", until = "", importance = "" }: AdvancedFilters = {}): boolean {
  if (sender && !scopeMatch(msg.from, sender)) return false;
  if (importance && String(msg.importance ?? "").toLowerCase() !== String(importance).toLowerCase()) return false;
  if ((since || until) && !inTimeRange(msg.createdDateTime, since, until)) return false;
  return true;
}

function mapChatMessage(m: TeamsGraphMessage, meta: Partial<TeamsMessageRow> = {}): TeamsMessageRow {
  const mentions = Array.isArray(m.mentions) ? m.mentions.map((x) => x?.mentionText).filter((v): v is string => Boolean(v)) : [];
  const attachmentNames = Array.isArray(m.attachments) ? m.attachments.map((x) => x?.name).filter((v): v is string => Boolean(v)) : [];
  return {
    id: String(m.id ?? ""),
    sourceType: "chat",
    sourcePath: meta.sourcePath ?? null,
    from: fromDisplayName(m),
    createdDateTime: m.createdDateTime ?? null,
    importance: m.importance ?? "normal",
    webUrl: m.webUrl ?? null,
    subject: m.subject ?? null,
    summary: m.summary ?? null,
    bodyPreview: m.bodyPreview ?? stripHtml(m.body?.content ?? ""),
    mentions,
    attachmentNames,
    chatId: meta.chatId ?? null,
    chatTopic: meta.chatTopic ?? null,
    teamId: null,
    teamName: null,
    channelId: null,
    channelName: null
  };
}

function mapChannelMessage(m: TeamsGraphMessage, meta: Partial<TeamsMessageRow> = {}): TeamsMessageRow {
  const mentions = Array.isArray(m.mentions) ? m.mentions.map((x) => x?.mentionText).filter((v): v is string => Boolean(v)) : [];
  const attachmentNames = Array.isArray(m.attachments) ? m.attachments.map((x) => x?.name).filter((v): v is string => Boolean(v)) : [];
  return {
    id: String(m.id ?? ""),
    sourceType: "channel",
    sourcePath: meta.sourcePath ?? null,
    from: fromDisplayName(m),
    createdDateTime: m.createdDateTime ?? null,
    importance: m.importance ?? "normal",
    webUrl: m.webUrl ?? null,
    subject: m.subject ?? null,
    summary: m.summary ?? null,
    bodyPreview: stripHtml(m.body?.content ?? m.summary ?? m.subject ?? ""),
    mentions,
    attachmentNames,
    chatId: null,
    chatTopic: null,
    teamId: meta.teamId ?? null,
    teamName: meta.teamName ?? null,
    channelId: meta.channelId ?? null,
    channelName: meta.channelName ?? null
  };
}

function dedupeMessages(rows: TeamsMessageRow[]): TeamsMessageRow[] {
  const seen = new Set<string>();
  const out: TeamsMessageRow[] = [];
  for (const row of rows) {
    const key = `${row.sourceType}:${row.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function sortNewest(rows: TeamsMessageRow[]): TeamsMessageRow[] {
  return [...rows].sort((a, b) => String(b.createdDateTime).localeCompare(String(a.createdDateTime)));
}

async function graphGet<T>(graph: GraphClientLike | null, path: string): Promise<GraphCollection<T>> {
  if (!graph?.get) throw new Error("Graph client is not configured.");
  return asCollection<T>(await graph.get(path));
}

async function collectChatMessages(
  graph: GraphClientLike | null,
  {
    top,
    depth,
    sinceWindow,
    sinceFilter,
    untilFilter,
    queryTokens,
    team,
    channel,
    sender,
    importance
  }: {
    top: number;
    depth: TeamsDepth;
    sinceWindow: Date | null;
    sinceFilter: string;
    untilFilter: string;
    queryTokens: string[];
    team: string;
    channel: string;
    sender: string;
    importance: TeamsImportance | string;
  }
): Promise<ChatCollectionResult> {
  const cfg = depthConfig(depth);
  const rows: TeamsMessageRow[] = [];
  const sources: string[] = [];
  const limitations: string[] = [];
  const coverage: ChatCoverage = { chatsScanned: 0, chatMessagesScanned: 0 };
  const catalog: Pick<TeamsCatalog, "chats"> = { chats: [] };

  const primaryPath = `/me/chats/getAllMessages?$top=${top}`;
  try {
    const data = await graphGet<TeamsGraphMessage>(graph, primaryPath);
    sources.push("me.chats.getAllMessages");
    for (const raw of data.value ?? []) {
      coverage.chatMessagesScanned += 1;
      const mapped = mapChatMessage(raw, { sourcePath: "me.chats.getAllMessages" });
      if (isWithinWindow(mapped.createdDateTime, sinceWindow) && matchesAdvancedFilters(mapped, { sender, since: sinceFilter, until: untilFilter, importance })) {
        rows.push(mapped);
      }
      if (rows.length >= top) break;
    }
    return { rows, sources, limitations, coverage, catalog };
  } catch (error) {
    if (!shouldUseDelegatedFallback(error)) throw error;
    limitations.push("getAllMessages unsupported in delegated context; used chat fallback");
  }

  const chatsData = await getChats(graph, cfg.maxChats);
  sources.push("me.chats.messages_fallback");
  const chats = prioritizeByQuery(chatsData.value ?? [], (c) => c.topic ?? "", queryTokens);
  coverage.chatsScanned = chats.length;
  catalog.chats = chats.map((chat) => ({ id: chat.id ?? null, label: chat.topic ?? "direct", webUrl: chat.webUrl ?? null }));

  for (const chat of chats) {
    const chatIdValue = String(chat.id ?? "").trim();
    if (!chatIdValue) continue;
    if (team || channel) {
      const topic = chat.topic ?? "";
      const scopeText = [team, channel].filter(Boolean).join(" ");
      if (!scopeMatch(topic, scopeText)) continue;
    }
    if (shouldSkipChat(chatIdValue)) {
      limitations.push(`skipped unstable chat ${chatIdValue}; backoff active`);
      continue;
    }
    const chatId = encodeURIComponent(chatIdValue);
    const msgPath =
      `/me/chats/${chatId}/messages` +
      `?$top=${cfg.perChat}` +
      "&$select=id,createdDateTime,from,importance,webUrl,subject,summary,bodyPreview,body,mentions,attachments";
    try {
      const msgData = await graphGet<TeamsGraphMessage>(graph, msgPath);
      clearChatFailure(chatIdValue);
      for (const raw of msgData.value ?? []) {
        coverage.chatMessagesScanned += 1;
        const mapped = mapChatMessage(raw, {
          chatId: chatIdValue,
          chatTopic: chat.topic ?? null,
          sourcePath: "me.chats.messages_fallback"
        });
        if (isWithinWindow(mapped.createdDateTime, sinceWindow) && matchesAdvancedFilters(mapped, { sender, since: sinceFilter, until: untilFilter, importance })) {
          rows.push(mapped);
        }
        if (rows.length >= top) break;
      }
    } catch {
      markChatFailure(chatIdValue);
      limitations.push(`failed reading chat ${chatIdValue}; continued`);
    }
    if (rows.length >= top) break;
  }

  return { rows, sources, limitations, coverage, catalog };
}

async function collectChannelMessages(
  graph: GraphClientLike | null,
  {
    top,
    depth,
    sinceWindow,
    sinceFilter,
    untilFilter,
    queryTokens,
    team,
    channel,
    sender,
    importance
  }: {
    top: number;
    depth: TeamsDepth;
    sinceWindow: Date | null;
    sinceFilter: string;
    untilFilter: string;
    queryTokens: string[];
    team: string;
    channel: string;
    sender: string;
    importance: TeamsImportance | string;
  }
): Promise<ChannelCollectionResult> {
  const cfg = depthConfig(depth);
  const rows: TeamsMessageRow[] = [];
  const limitations: string[] = [];
  const coverage: ChannelCoverage = { teamsScanned: 0, channelsScanned: 0, channelMessagesScanned: 0 };
  const catalog: Pick<TeamsCatalog, "teams" | "channels"> = { teams: [], channels: [] };
  const sources: string[] = [];

  try {
    const teamsData = await getJoinedTeams(graph, cfg.maxTeams);
    const teams = prioritizeByQuery(teamsData.value ?? [], (t) => t.displayName ?? "", queryTokens).filter((t) => inTeamScope(t, team));
    coverage.teamsScanned = teams.length;
    catalog.teams = teams.map((teamRow) => ({ id: teamRow.id ?? null, label: teamRow.displayName ?? "", webUrl: teamRow.webUrl ?? null }));
    sources.push("me.joinedTeams");

    for (const teamRow of teams) {
      const teamIdValue = String(teamRow.id ?? "").trim();
      if (!teamIdValue) continue;
      const teamId = encodeURIComponent(teamIdValue);
      let channels: TeamsGraphChannel[] = [];
      try {
        const channelsData = await getTeamChannels(graph, teamId, cfg.maxChannelsPerTeam);
        channels = prioritizeByQuery(channelsData.value ?? [], (c) => c.displayName ?? "", queryTokens).filter((c) => inChannelScope(c, channel));
      } catch {
        limitations.push(`failed reading channels for team ${teamIdValue}; continued`);
      }
      coverage.channelsScanned += channels.length;
      for (const channelRow of channels) {
        catalog.channels.push({
          id: channelRow.id ?? null,
          label: channelRow.displayName ?? "",
          teamId: teamIdValue,
          teamName: teamRow.displayName ?? null,
          channelId: channelRow.id ?? null,
          channelName: channelRow.displayName ?? null,
          webUrl: channelRow.webUrl ?? null
        });
      }

      for (const channelRow of channels) {
        const channelIdValue = String(channelRow.id ?? "").trim();
        if (!channelIdValue) continue;
        const channelId = encodeURIComponent(channelIdValue);
        try {
          const msgData = await getChannelMessages(graph, teamId, channelId, cfg.perChannel);
          sources.push("teams.channels.messages");
          for (const raw of msgData.value ?? []) {
            coverage.channelMessagesScanned += 1;
            const mapped = mapChannelMessage(raw, {
              teamId: teamIdValue,
              teamName: teamRow.displayName ?? null,
              channelId: channelIdValue,
              channelName: channelRow.displayName ?? null,
              sourcePath: "teams.channels.messages"
            });
            if (isWithinWindow(mapped.createdDateTime, sinceWindow) && matchesAdvancedFilters(mapped, { sender, since: sinceFilter, until: untilFilter, importance })) {
              rows.push(mapped);
            }
            if (rows.length >= top) break;
          }
        } catch (error) {
          const text = String(error instanceof Error ? error.message : error);
          if (text.includes("403")) limitations.push("missing scope for channel messages");
          else limitations.push(`failed reading messages in ${teamIdValue}/${channelIdValue}; continued`);
        }
        if (rows.length >= top) break;
      }
      if (rows.length >= top) break;
    }
  } catch (error) {
    const text = String(error instanceof Error ? error.message : error);
    limitations.push(`channel retrieval unavailable: ${text}`);
  }

  return { rows, sources, limitations, coverage, catalog };
}

export async function fetchTeamsMessages(
  graph: GraphClientLike | null,
  {
    top = 25,
    surface = "both",
    window = "today",
    depth = "balanced",
    query = "",
    team = "",
    channel = "",
    sender = "",
    since = "",
    until = "",
    importance = ""
  }: Partial<TeamsParams> = {}
): Promise<TeamsFetchResult> {
  const limit = clamp(top, 1, 5000, 25);
  const sinceWindow = windowStart(window);
  const sinceFilter = String(since ?? "").trim();
  const untilFilter = String(until ?? "").trim();
  const mode = String(surface ?? "both").toLowerCase() as TeamsSurface | string;
  const queryTokens = tokenizeQuery(query);

  const rows: TeamsMessageRow[] = [];
  const sources: string[] = [];
  const limitations: string[] = [];
  const coverage: FetchCoverage = {
    chatsScanned: 0,
    chatMessagesScanned: 0,
    teamsScanned: 0,
    channelsScanned: 0,
    channelMessagesScanned: 0,
    totalCandidates: 0
  };
  const catalog: TeamsCatalog = { chats: [], teams: [], channels: [] };

  if (mode === "chats" || mode === "both") {
    const chat = await collectChatMessages(graph, {
      top: limit,
      depth,
      sinceWindow,
      sinceFilter,
      untilFilter,
      queryTokens,
      team,
      channel,
      sender,
      importance
    });
    rows.push(...chat.rows);
    sources.push(...chat.sources);
    limitations.push(...chat.limitations);
    coverage.chatsScanned += chat.coverage.chatsScanned;
    coverage.chatMessagesScanned += chat.coverage.chatMessagesScanned;
    catalog.chats.push(...chat.catalog.chats);
  }

  if (mode === "channels" || mode === "both") {
    const channelData = await collectChannelMessages(graph, {
      top: limit,
      depth,
      sinceWindow,
      sinceFilter,
      untilFilter,
      queryTokens,
      team,
      channel,
      sender,
      importance
    });
    rows.push(...channelData.rows);
    sources.push(...channelData.sources);
    limitations.push(...channelData.limitations);
    coverage.teamsScanned += channelData.coverage.teamsScanned;
    coverage.channelsScanned += channelData.coverage.channelsScanned;
    coverage.channelMessagesScanned += channelData.coverage.channelMessagesScanned;
    catalog.teams.push(...channelData.catalog.teams);
    catalog.channels.push(...channelData.catalog.channels);
  }

  const unique = sortNewest(dedupeMessages(rows)).slice(0, limit);
  coverage.totalCandidates = unique.length;

  return {
    messages: unique,
    sources: [...new Set(sources)],
    coverage,
    limitations: [...new Set(limitations)],
    catalog: {
      chats: dedupeCatalog(catalog.chats),
      teams: dedupeCatalog(catalog.teams),
      channels: dedupeCatalog(catalog.channels)
    }
  };
}

function dedupeCatalog(rows: TeamsCatalogRow[]): TeamsCatalogRow[] {
  const seen = new Set<string>();
  const out: TeamsCatalogRow[] = [];
  for (const row of rows) {
    const key = `${row.id ?? ""}:${row.teamId ?? ""}:${row.channelId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export async function probeTeamsAccess(graph: GraphClientLike | null): Promise<TeamsProbeResult> {
  const probes = {} as TeamsProbeResult;
  probes.chats = await runProbe<TeamsGraphChat>(graph, "/me/chats?$top=1&$select=id,topic");
  probes.chatMessages = await runProbe<TeamsGraphMessage>(graph, "/me/chats/getAllMessages?$top=1");

  const joinedTeams = await runJoinedTeamsProbe(graph);
  probes.joinedTeams = joinedTeams;
  if (!joinedTeams.ok) {
    probes.channels = { ok: false, skipped: true, reason: "joinedTeams probe failed" };
    probes.channelMessages = { ok: false, skipped: true, reason: "joinedTeams probe failed" };
    return probes;
  }

  const firstTeamId = joinedTeams.data?.value?.[0]?.id;
  if (!firstTeamId) {
    probes.channels = { ok: true, empty: true, endpoint: "/teams/{id}/channels" };
    probes.channelMessages = { ok: true, empty: true, endpoint: "/teams/{id}/channels/{id}/messages" };
    return probes;
  }

  const encTeam = encodeURIComponent(firstTeamId);
  const channels = await runChannelsProbe(graph, encTeam);
  probes.channels = channels;
  if (!channels.ok || !channels.data?.value?.[0]?.id) {
    probes.channelMessages = {
      ok: channels.ok,
      skipped: true,
      reason: channels.ok ? "no channels found" : "channels probe failed"
    };
    return probes;
  }

  const firstChannel = encodeURIComponent(String(channels.data.value[0].id));
  probes.channelMessages = await runChannelMessagesProbe(graph, encTeam, firstChannel);
  return probes;
}

async function runProbe<T>(graph: GraphClientLike | null, path: string): Promise<ProbeResult<GraphCollection<T>>> {
  try {
    const data = await graphGet<T>(graph, path);
    return { ok: true, endpoint: path, count: Array.isArray(data.value) ? data.value.length : 0, data };
  } catch (error) {
    return { ok: false, endpoint: path, error: String(error instanceof Error ? error.message : error) };
  }
}

async function runChannelMessagesProbe(
  graph: GraphClientLike | null,
  encTeam: string,
  encChannel: string
): Promise<ProbeResult<GraphCollection<TeamsGraphMessage>>> {
  const variants = [
    `/teams/${encTeam}/channels/${encChannel}/messages?$top=1&$select=id,createdDateTime`,
    `/teams/${encTeam}/channels/${encChannel}/messages?$top=1`,
    `/teams/${encTeam}/channels/${encChannel}/messages`
  ];
  for (const path of variants) {
    try {
      const data = await graphGet<TeamsGraphMessage>(graph, path);
      return { ok: true, endpoint: path, count: Array.isArray(data.value) ? data.value.length : 0, data };
    } catch (error) {
      if (isSelectNotAllowedError(error) || isTopNotAllowedError(error)) {
        continue;
      }
      return { ok: false, endpoint: path, error: String(error instanceof Error ? error.message : error) };
    }
  }
  return {
    ok: false,
    endpoint: variants[0] ?? "",
    error: "Channel messages endpoint rejected supported query variants for this tenant."
  };
}

async function runJoinedTeamsProbe(graph: GraphClientLike | null): Promise<ProbeResult<GraphCollection<TeamsGraphTeam>>> {
  const primary = "/me/joinedTeams?$top=1&$select=id,displayName";
  try {
    const data = await graphGet<TeamsGraphTeam>(graph, primary);
    return { ok: true, endpoint: primary, count: Array.isArray(data.value) ? data.value.length : 0, data };
  } catch (error) {
    if (!isTopNotAllowedError(error)) {
      return { ok: false, endpoint: primary, error: String(error instanceof Error ? error.message : error) };
    }
  }

  const fallback = "/me/joinedTeams?$select=id,displayName";
  try {
    const data = await graphGet<TeamsGraphTeam>(graph, fallback);
    return { ok: true, endpoint: fallback, count: Array.isArray(data.value) ? Math.min(1, data.value.length) : 0, data };
  } catch (error) {
    return { ok: false, endpoint: fallback, error: String(error instanceof Error ? error.message : error) };
  }
}

async function runChannelsProbe(graph: GraphClientLike | null, encTeam: string): Promise<ProbeResult<GraphCollection<TeamsGraphChannel>>> {
  const primary = `/teams/${encTeam}/channels?$top=1&$select=id,displayName`;
  try {
    const data = await graphGet<TeamsGraphChannel>(graph, primary);
    return { ok: true, endpoint: primary, count: Array.isArray(data.value) ? data.value.length : 0, data };
  } catch (error) {
    if (!isTopNotAllowedError(error)) {
      return { ok: false, endpoint: primary, error: String(error instanceof Error ? error.message : error) };
    }
  }

  const fallback = `/teams/${encTeam}/channels?$select=id,displayName`;
  try {
    const data = await graphGet<TeamsGraphChannel>(graph, fallback);
    return { ok: true, endpoint: fallback, count: Array.isArray(data.value) ? Math.min(1, data.value.length) : 0, data };
  } catch (error) {
    return { ok: false, endpoint: fallback, error: String(error instanceof Error ? error.message : error) };
  }
}

async function getJoinedTeams(graph: GraphClientLike | null, limit: number): Promise<GraphCollection<TeamsGraphTeam>> {
  const primary = `/me/joinedTeams?$top=${Math.max(1, Math.min(200, limit))}&$select=id,displayName`;
  try {
    return await graphGet<TeamsGraphTeam>(graph, primary);
  } catch (error) {
    if (!isTopNotAllowedError(error)) throw error;
  }
  const fallback = "/me/joinedTeams?$select=id,displayName";
  const data = await graphGet<TeamsGraphTeam>(graph, fallback);
  const rows = Array.isArray(data.value) ? data.value.slice(0, Math.max(1, Math.min(200, limit))) : [];
  return { ...data, value: rows };
}

async function getChats(graph: GraphClientLike | null, limit: number): Promise<GraphCollection<TeamsGraphChat>> {
  const capped = Math.max(1, Math.min(50, Number(limit) || 15));
  const primary = `/me/chats?$top=${capped}&$select=id,topic,webUrl`;
  try {
    return await graphGet<TeamsGraphChat>(graph, primary);
  } catch (error) {
    if (!isTopExceededError(error) || capped === 50) throw error;
  }
  const fallback = "/me/chats?$top=50&$select=id,topic,webUrl";
  return await graphGet<TeamsGraphChat>(graph, fallback);
}

async function getTeamChannels(graph: GraphClientLike | null, encTeam: string, limit: number): Promise<GraphCollection<TeamsGraphChannel>> {
  const primary = `/teams/${encTeam}/channels?$top=${Math.max(1, Math.min(200, limit))}&$select=id,displayName,webUrl`;
  try {
    return await graphGet<TeamsGraphChannel>(graph, primary);
  } catch (error) {
    if (!isTopNotAllowedError(error)) throw error;
  }
  const fallback = `/teams/${encTeam}/channels?$select=id,displayName,webUrl`;
  const data = await graphGet<TeamsGraphChannel>(graph, fallback);
  const rows = Array.isArray(data.value) ? data.value.slice(0, Math.max(1, Math.min(200, limit))) : [];
  return { ...data, value: rows };
}

async function getChannelMessages(
  graph: GraphClientLike | null,
  encTeam: string,
  encChannel: string,
  limit: number
): Promise<GraphCollection<TeamsGraphMessage>> {
  const bounded = Math.max(1, Math.min(200, limit));
  const variants = [
    `/teams/${encTeam}/channels/${encChannel}/messages?$top=${bounded}&$select=id,createdDateTime,from,importance,webUrl,subject,summary,body,mentions,attachments`,
    `/teams/${encTeam}/channels/${encChannel}/messages?$top=${bounded}`,
    `/teams/${encTeam}/channels/${encChannel}/messages`
  ];

  for (const path of variants) {
    try {
      const data = await graphGet<TeamsGraphMessage>(graph, path);
      if (path.endsWith("/messages")) {
        const rows = Array.isArray(data.value) ? data.value.slice(0, bounded) : [];
        return { ...data, value: rows };
      }
      return data;
    } catch (error) {
      if (isSelectNotAllowedError(error) || isTopNotAllowedError(error)) continue;
      throw error;
    }
  }
  throw new Error("Graph channel messages endpoint rejected supported query variants.");
}

function isTopNotAllowedError(error: unknown): boolean {
  const text = String(error instanceof Error ? error.message : error ?? "").toLowerCase();
  return text.includes("query option 'top' is not allowed");
}

function isTopExceededError(error: unknown): boolean {
  const text = String(error instanceof Error ? error.message : error ?? "").toLowerCase();
  return text.includes("limit of '50' for top query has been exceeded");
}

function isSelectNotAllowedError(error: unknown): boolean {
  const text = String(error instanceof Error ? error.message : error ?? "").toLowerCase();
  return text.includes("query option 'select' is not allowed");
}

function shouldUseDelegatedFallback(error: unknown): boolean {
  const text = String(error instanceof Error ? error.message : error ?? "").toLowerCase();
  return text.includes("preconditionfailed") || text.includes("not supported in delegated context") || text.includes("getallmessages");
}
