import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fetchTeamsMessages } from "../agents/teams/actions/_teamsGraph.js";

interface TeamsMessageRow {
  message_id: string;
  source_type: string;
  from_name: string | null;
  created_at: string;
  importance: string | null;
  web_url: string | null;
  subject: string | null;
  summary: string | null;
  body_preview: string | null;
  chat_id: string | null;
  chat_topic: string | null;
  team_id: string | null;
  team_name: string | null;
  channel_id: string | null;
  channel_name: string | null;
}

interface TeamsEntityRow {
  entity_type: string;
  entity_id: string;
  label: string;
  team_name: string | null;
  channel_name: string | null;
  web_url: string | null;
}

interface CountRow {
  count?: number;
}

interface LatestCreatedRow {
  created?: string | null;
}

interface CheckpointRow {
  source: string;
  cursor_or_time: string | null;
  last_success_at: string | null;
  last_error: string | null;
}

interface SyncStateRow {
  source: string;
  last_mode: string | null;
  last_delta_since: string | null;
  last_upserts: number | null;
  last_updates: number | null;
  last_unchanged: number | null;
  last_indexed: number | null;
  total_retained: number | null;
  updated_at: string | null;
}

interface ScopeStatsRow {
  chats?: number | null;
  channels?: number | null;
}

interface TeamsCatalogEntry {
  id?: string;
  label?: string;
  teamId?: string | null;
  teamName?: string | null;
  channelId?: string | null;
  channelName?: string | null;
  webUrl?: string | null;
}

export interface TeamsIndexedMessage {
  id: string;
  sourceType: string;
  sourcePath: string;
  from: string | null;
  createdDateTime: string;
  importance: string;
  webUrl: string | null;
  subject: string | null;
  summary: string | null;
  bodyPreview: string;
  mentions: unknown[];
  attachmentNames: unknown[];
  chatId: string | null;
  chatTopic: string | null;
  teamId: string | null;
  teamName: string | null;
  channelId: string | null;
  channelName: string | null;
}

export interface TeamsFallbackMatch {
  type: string;
  id: string;
  label: string;
  teamName: string | null;
  channelName: string | null;
  webUrl: string | null;
  score: number;
  why: string;
}

interface TeamsCoverage {
  chatsScanned: number;
  chatMessagesScanned: number;
  channelsScanned: number;
  channelMessagesScanned: number;
  totalCandidates: number;
}

interface TeamsCatalog {
  chats?: TeamsCatalogEntry[];
  teams?: TeamsCatalogEntry[];
  channels?: TeamsCatalogEntry[];
}

interface FetchTeamsMessagesResult {
  messages?: TeamsIndexedMessage[];
  catalog?: TeamsCatalog;
  coverage?: Partial<TeamsCoverage>;
  limitations?: string[];
}

interface SyncOptions {
  top?: number;
  surface?: string;
  depth?: string;
  window?: string;
  mode?: string;
  deltaSinceIso?: string;
  deltaLookbackHours?: number;
}

interface SearchOptions {
  query?: string;
  top?: number;
  window?: string;
  surface?: string;
  team?: string;
  channel?: string;
  sender?: string;
  since?: string;
  until?: string;
  importance?: string;
}

export interface TeamsIndexStatus {
  enabled: boolean;
  backend: string;
  messages: number;
  bySource: {
    chats: number;
    channels: number;
  };
  latestCreatedAt: string | null;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  checkpointTime: string | null;
  lastSyncMode: string | null;
  lastDeltaSince: string | null;
  lastDeltaUpserts: number;
  lastDeltaUpdates: number;
  lastDeltaUnchanged: number;
  lastIndexed: number;
  stale: boolean;
}

export interface TeamsSearchResult {
  messages: TeamsIndexedMessage[];
  fallbackMatches: TeamsFallbackMatch[];
  coverage: TeamsCoverage;
  limitations: string[];
  sources: string[];
}

export interface TeamsSyncResult {
  status: "ok" | "error";
  message: string;
  mode?: string;
  deltaSince?: string | null;
  indexed?: number;
  upserts?: number;
  updates?: number;
  unchanged?: number;
  retainedFromThisRun?: number;
  droppedByRetention?: number;
  totalRetained?: number;
  coverage?: Partial<TeamsCoverage>;
  limitations?: string[];
}

type GraphLike = {
  get?: (endpoint: string) => Promise<unknown>;
};

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function sinceIso(window: unknown): string | null {
  const now = new Date();
  const lower = String(window ?? "today").toLowerCase();
  if (lower === "all") return null;
  if (lower === "30d") return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  if (lower === "7d") return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  if (lower === "48h") return new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).toISOString();
}

function tokenizeQuery(query: unknown): string[] {
  return String(query ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function mapRow(row: TeamsMessageRow): TeamsIndexedMessage {
  return {
    id: row.message_id,
    sourceType: row.source_type,
    sourcePath: "teams.local_index",
    from: row.from_name,
    createdDateTime: row.created_at,
    importance: row.importance ?? "normal",
    webUrl: row.web_url ?? null,
    subject: row.subject ?? null,
    summary: row.summary ?? null,
    bodyPreview: row.body_preview ?? "",
    mentions: [],
    attachmentNames: [],
    chatId: row.chat_id ?? null,
    chatTopic: row.chat_topic ?? null,
    teamId: row.team_id ?? null,
    teamName: row.team_name ?? null,
    channelId: row.channel_id ?? null,
    channelName: row.channel_name ?? null
  };
}

function isSameMessage(existing: TeamsMessageRow, row: TeamsIndexedMessage): boolean {
  return (
    String(existing.source_type ?? "") === String(row.sourceType ?? "") &&
    String(existing.from_name ?? "") === String(row.from ?? "") &&
    String(existing.created_at ?? "") === String(row.createdDateTime ?? "") &&
    String(existing.importance ?? "") === String(row.importance ?? "") &&
    String(existing.web_url ?? "") === String(row.webUrl ?? "") &&
    String(existing.subject ?? "") === String(row.subject ?? "") &&
    String(existing.summary ?? "") === String(row.summary ?? "") &&
    String(existing.body_preview ?? "") === String(row.bodyPreview ?? "") &&
    String(existing.chat_id ?? "") === String(row.chatId ?? "") &&
    String(existing.chat_topic ?? "") === String(row.chatTopic ?? "") &&
    String(existing.team_id ?? "") === String(row.teamId ?? "") &&
    String(existing.team_name ?? "") === String(row.teamName ?? "") &&
    String(existing.channel_id ?? "") === String(row.channelId ?? "") &&
    String(existing.channel_name ?? "") === String(row.channelName ?? "")
  );
}

function maxTimestamp(values: Array<string | null | undefined> = []): string {
  let max = 0;
  for (const value of values) {
    const ts = new Date(String(value ?? "")).getTime();
    if (!Number.isNaN(ts) && ts > max) max = ts;
  }
  if (!max) return "";
  return new Date(max).toISOString();
}

export class TeamsIndex {
  dbPath: string;
  retentionDays: number;
  deltaLookbackHours: number;
  ready: boolean;
  syncIntervalMs: number;
  staleThresholdMs: number;
  db!: DatabaseSync;
  upsertMessageStmt!: ReturnType<DatabaseSync["prepare"]>;
  deleteFtsStmt!: ReturnType<DatabaseSync["prepare"]>;
  insertFtsStmt!: ReturnType<DatabaseSync["prepare"]>;
  upsertEntityStmt!: ReturnType<DatabaseSync["prepare"]>;
  upsertCheckpointStmt!: ReturnType<DatabaseSync["prepare"]>;
  getCheckpointStmt!: ReturnType<DatabaseSync["prepare"]>;
  getSyncStateStmt!: ReturnType<DatabaseSync["prepare"]>;
  upsertSyncStateStmt!: ReturnType<DatabaseSync["prepare"]>;
  getMessageByIdStmt!: ReturnType<DatabaseSync["prepare"]>;
  countMessagesStmt!: ReturnType<DatabaseSync["prepare"]>;
  latestCreatedStmt!: ReturnType<DatabaseSync["prepare"]>;
  latestSyncStmt!: ReturnType<DatabaseSync["prepare"]>;
  statsScopeStmt!: ReturnType<DatabaseSync["prepare"]>;

  constructor({
    dbPath = "./data/teams-index.sqlite",
    retentionDays = 180,
    deltaLookbackHours = 6,
    deltaIntervalMs = 5 * 60 * 1000
  }: {
    dbPath?: string;
    retentionDays?: number;
    deltaLookbackHours?: number;
    deltaIntervalMs?: number;
  } = {}) {
    this.dbPath = path.resolve(process.cwd(), dbPath);
    this.retentionDays = clamp(retentionDays, 30, 3650, 180);
    this.deltaLookbackHours = clamp(deltaLookbackHours, 1, 168, 6);
    this.ready = false;
    this.syncIntervalMs = clamp(deltaIntervalMs, 60 * 1000, 24 * 60 * 60 * 1000, 10 * 60 * 1000);
    this.staleThresholdMs = 30 * 60 * 1000;
  }

  initialize(): void {
    if (this.ready) return;
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS teams_messages (
        message_id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL,
        from_name TEXT,
        created_at TEXT NOT NULL,
        importance TEXT,
        web_url TEXT,
        subject TEXT,
        summary TEXT,
        body_preview TEXT,
        chat_id TEXT,
        chat_topic TEXT,
        team_id TEXT,
        team_name TEXT,
        channel_id TEXT,
        channel_name TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS teams_entities (
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        label TEXT NOT NULL,
        team_id TEXT,
        team_name TEXT,
        channel_id TEXT,
        channel_name TEXT,
        web_url TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (entity_type, entity_id)
      );
      CREATE TABLE IF NOT EXISTS sync_checkpoints (
        source TEXT PRIMARY KEY,
        cursor_or_time TEXT,
        last_success_at TEXT,
        last_error TEXT
      );
      CREATE TABLE IF NOT EXISTS sync_state (
        source TEXT PRIMARY KEY,
        last_mode TEXT,
        last_delta_since TEXT,
        last_upserts INTEGER,
        last_updates INTEGER,
        last_unchanged INTEGER,
        last_indexed INTEGER,
        total_retained INTEGER,
        updated_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_teams_messages_created ON teams_messages(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_teams_messages_scope ON teams_messages(source_type, team_name, channel_name, chat_topic);
      CREATE INDEX IF NOT EXISTS idx_teams_entities_label ON teams_entities(label);
    `);
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS teams_messages_fts USING fts5(
        message_id UNINDEXED,
        content
      );
    `);
    this.upsertMessageStmt = this.db.prepare(`
      INSERT INTO teams_messages (
        message_id, source_type, from_name, created_at, importance, web_url, subject, summary, body_preview,
        chat_id, chat_topic, team_id, team_name, channel_id, channel_name, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(message_id) DO UPDATE SET
        source_type=excluded.source_type,
        from_name=excluded.from_name,
        created_at=excluded.created_at,
        importance=excluded.importance,
        web_url=excluded.web_url,
        subject=excluded.subject,
        summary=excluded.summary,
        body_preview=excluded.body_preview,
        chat_id=excluded.chat_id,
        chat_topic=excluded.chat_topic,
        team_id=excluded.team_id,
        team_name=excluded.team_name,
        channel_id=excluded.channel_id,
        channel_name=excluded.channel_name,
        updated_at=excluded.updated_at
    `);
    this.deleteFtsStmt = this.db.prepare("DELETE FROM teams_messages_fts WHERE message_id = ?");
    this.insertFtsStmt = this.db.prepare("INSERT INTO teams_messages_fts(message_id, content) VALUES (?, ?)");
    this.upsertEntityStmt = this.db.prepare(`
      INSERT INTO teams_entities (
        entity_type, entity_id, label, team_id, team_name, channel_id, channel_name, web_url, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(entity_type, entity_id) DO UPDATE SET
        label=excluded.label,
        team_id=excluded.team_id,
        team_name=excluded.team_name,
        channel_id=excluded.channel_id,
        channel_name=excluded.channel_name,
        web_url=excluded.web_url,
        updated_at=excluded.updated_at
    `);
    this.upsertCheckpointStmt = this.db.prepare(`
      INSERT INTO sync_checkpoints(source, cursor_or_time, last_success_at, last_error)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(source) DO UPDATE SET
        cursor_or_time=excluded.cursor_or_time,
        last_success_at=excluded.last_success_at,
        last_error=excluded.last_error
    `);
    this.getCheckpointStmt = this.db.prepare("SELECT source, cursor_or_time, last_success_at, last_error FROM sync_checkpoints WHERE source = ?");
    this.getSyncStateStmt = this.db.prepare(
      "SELECT source,last_mode,last_delta_since,last_upserts,last_updates,last_unchanged,last_indexed,total_retained,updated_at FROM sync_state WHERE source = ?"
    );
    this.upsertSyncStateStmt = this.db.prepare(`
      INSERT INTO sync_state(
        source,last_mode,last_delta_since,last_upserts,last_updates,last_unchanged,last_indexed,total_retained,updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source) DO UPDATE SET
        last_mode=excluded.last_mode,
        last_delta_since=excluded.last_delta_since,
        last_upserts=excluded.last_upserts,
        last_updates=excluded.last_updates,
        last_unchanged=excluded.last_unchanged,
        last_indexed=excluded.last_indexed,
        total_retained=excluded.total_retained,
        updated_at=excluded.updated_at
    `);
    this.getMessageByIdStmt = this.db.prepare(`
      SELECT message_id, source_type, from_name, created_at, importance, web_url, subject, summary, body_preview, chat_id, chat_topic, team_id, team_name, channel_id, channel_name
      FROM teams_messages
      WHERE message_id = ?
    `);
    this.countMessagesStmt = this.db.prepare("SELECT COUNT(*) AS count FROM teams_messages");
    this.latestCreatedStmt = this.db.prepare("SELECT MAX(created_at) AS created FROM teams_messages");
    this.latestSyncStmt = this.db.prepare("SELECT last_success_at FROM sync_checkpoints WHERE source = 'teams'");
    this.statsScopeStmt = this.db.prepare(`
      SELECT
        SUM(CASE WHEN source_type='chat' THEN 1 ELSE 0 END) AS chats,
        SUM(CASE WHEN source_type='channel' THEN 1 ELSE 0 END) AS channels
      FROM teams_messages
    `);
    this.ready = true;
  }

  getConfig(): {
    dbPath: string;
    retentionDays: number;
    deltaLookbackHours: number;
    syncIntervalMs: number;
    staleThresholdMs: number;
  } {
    return {
      dbPath: this.dbPath,
      retentionDays: this.retentionDays,
      deltaLookbackHours: this.deltaLookbackHours,
      syncIntervalMs: this.syncIntervalMs,
      staleThresholdMs: this.staleThresholdMs
    };
  }

  getStatus(): TeamsIndexStatus {
    this.initialize();
    const messages = Number((this.countMessagesStmt.get() as CountRow | undefined)?.count ?? 0);
    const latestCreated = (this.latestCreatedStmt.get() as LatestCreatedRow | undefined)?.created ?? null;
    const checkpoint = (this.getCheckpointStmt.get("teams") as CheckpointRow | undefined) ?? null;
    const syncState = (this.getSyncStateStmt.get("teams") as SyncStateRow | undefined) ?? null;
    const scope = (this.statsScopeStmt.get() as ScopeStatsRow | undefined) ?? { chats: 0, channels: 0 };
    const lastSuccessAt = checkpoint?.last_success_at ?? null;
    const stale = lastSuccessAt ? Date.now() - new Date(lastSuccessAt).getTime() > this.staleThresholdMs : true;
    return {
      enabled: true,
      backend: "sqlite_fts5",
      messages,
      bySource: {
        chats: Number(scope.chats ?? 0),
        channels: Number(scope.channels ?? 0)
      },
      latestCreatedAt: latestCreated,
      lastSyncAt: lastSuccessAt,
      lastSyncError: checkpoint?.last_error ?? null,
      checkpointTime: checkpoint?.cursor_or_time ?? null,
      lastSyncMode: syncState?.last_mode ?? null,
      lastDeltaSince: syncState?.last_delta_since ?? null,
      lastDeltaUpserts: Number(syncState?.last_upserts ?? 0),
      lastDeltaUpdates: Number(syncState?.last_updates ?? 0),
      lastDeltaUnchanged: Number(syncState?.last_unchanged ?? 0),
      lastIndexed: Number(syncState?.last_indexed ?? 0),
      stale
    };
  }

  async syncFromGraph(graphClient: GraphLike | null | undefined, options: SyncOptions = {}): Promise<TeamsSyncResult> {
    this.initialize();
    const startedAt = new Date().toISOString();
    const { top = 100, surface = "both", depth = "deep", window = "all", mode = "full", deltaSinceIso = "", deltaLookbackHours } = options;
    const safeTop = clamp(top, 1, 5000, 100);
    const normalizedMode = String(mode ?? "full").toLowerCase() === "delta" ? "delta" : "full";
    const checkpoint = (this.getCheckpointStmt.get("teams") as CheckpointRow | undefined) ?? null;
    const lookbackMs = clamp(deltaLookbackHours, 1, 168, this.deltaLookbackHours) * 60 * 60 * 1000;
    const baseCursor = String(deltaSinceIso || checkpoint?.cursor_or_time || "").trim();
    const deltaSince = normalizedMode === "delta"
      ? (() => {
          if (!baseCursor) return new Date(Date.now() - lookbackMs).toISOString();
          const d = new Date(baseCursor);
          if (Number.isNaN(d.getTime())) return new Date(Date.now() - lookbackMs).toISOString();
          return new Date(d.getTime() - lookbackMs).toISOString();
        })()
      : "";
    if (!graphClient) {
      this.upsertCheckpointStmt.run("teams", null, null, "graph client unavailable");
      return { status: "error", message: "Graph client unavailable for Teams sync." };
    }
    try {
      const result = (await fetchTeamsMessages(graphClient, {
        top: safeTop,
        surface: surface as import("../agents/teams/actions/_teamsParams.js").TeamsSurface,
        depth: depth as import("../agents/teams/actions/_teamsParams.js").TeamsDepth,
        window: (normalizedMode === "delta" ? "all" : window) as import("../agents/teams/actions/_teamsParams.js").TeamsWindow,
        query: "",
        since: deltaSince
      })) as FetchTeamsMessagesResult;
      const now = new Date().toISOString();
      const beforeCount = Number((this.countMessagesStmt.get() as CountRow | undefined)?.count ?? 0);
      let upserts = 0;
      let updates = 0;
      let unchanged = 0;
      for (const row of result.messages ?? []) {
        const existing = this.getMessageByIdStmt.get(row.id) as TeamsMessageRow | undefined;
        if (!existing) upserts += 1;
        else if (isSameMessage(existing, row)) unchanged += 1;
        else updates += 1;
        this.upsertMessageStmt.run(
          row.id,
          row.sourceType ?? "chat",
          row.from ?? null,
          row.createdDateTime ?? now,
          row.importance ?? "normal",
          row.webUrl ?? null,
          row.subject ?? null,
          row.summary ?? null,
          row.bodyPreview ?? "",
          row.chatId ?? null,
          row.chatTopic ?? null,
          row.teamId ?? null,
          row.teamName ?? null,
          row.channelId ?? null,
          row.channelName ?? null,
          now
        );
        const content = [
          row.bodyPreview,
          row.subject,
          row.summary,
          row.from,
          row.chatTopic,
          row.teamName,
          row.channelName
        ]
          .map((x) => String(x ?? "").trim())
          .filter(Boolean)
          .join(" | ");
        this.deleteFtsStmt.run(row.id);
        this.insertFtsStmt.run(row.id, content);
      }
      const catalog = result.catalog ?? {};
      for (const entity of catalog.chats ?? []) {
        this.upsertEntityStmt.run(
          "chat",
          entity.id ?? "",
          entity.label ?? "",
          entity.teamId ?? null,
          entity.teamName ?? null,
          entity.channelId ?? null,
          entity.channelName ?? null,
          entity.webUrl ?? null,
          now
        );
      }
      for (const entity of catalog.teams ?? []) {
        this.upsertEntityStmt.run(
          "team",
          entity.id ?? "",
          entity.label ?? "",
          entity.teamId ?? null,
          entity.teamName ?? entity.label ?? null,
          entity.channelId ?? null,
          entity.channelName ?? null,
          entity.webUrl ?? null,
          now
        );
      }
      for (const entity of catalog.channels ?? []) {
        this.upsertEntityStmt.run(
          "channel",
          entity.id ?? "",
          entity.label ?? "",
          entity.teamId ?? null,
          entity.teamName ?? null,
          entity.channelId ?? entity.id ?? null,
          entity.channelName ?? entity.channelName ?? entity.label ?? null,
          entity.webUrl ?? null,
          now
        );
      }
      this.pruneRetention();
      const afterCount = Number((this.countMessagesStmt.get() as CountRow | undefined)?.count ?? 0);
      const indexed = result.messages?.length ?? 0;
      const retainedFromThisRun = Math.max(0, afterCount - beforeCount);
      const droppedByRetention = Math.max(0, indexed - retainedFromThisRun);
      const latestSeen = maxTimestamp((result.messages ?? []).map((m) => m.createdDateTime).filter(Boolean));
      const nextCursor = latestSeen || checkpoint?.cursor_or_time || now;
      this.upsertCheckpointStmt.run("teams", nextCursor, now, null);
      this.upsertSyncStateStmt.run(
        "teams",
        normalizedMode,
        deltaSince || null,
        upserts,
        updates,
        unchanged,
        indexed,
        afterCount,
        now
      );
      return {
        status: "ok",
        message:
          `Teams sync indexed ${indexed} message(s), retained ${retainedFromThisRun} new row(s)` +
          (droppedByRetention > 0 ? `, dropped ${droppedByRetention} by retention.` : "."),
        mode: normalizedMode,
        deltaSince: deltaSince || null,
        indexed,
        upserts,
        updates,
        unchanged,
        retainedFromThisRun,
        droppedByRetention,
        totalRetained: afterCount,
        coverage: result.coverage ?? {},
        limitations: result.limitations ?? []
      };
    } catch (error) {
      const msg = String(error instanceof Error ? error.message : error);
      this.upsertCheckpointStmt.run("teams", checkpoint?.cursor_or_time ?? startedAt, null, msg);
      return {
        status: "error",
        message: `Teams sync failed: ${msg}`
      };
    }
  }

  pruneRetention(): void {
    this.initialize();
    const cutoff = new Date(Date.now() - this.retentionDays * 24 * 60 * 60 * 1000).toISOString();
    this.db.prepare("DELETE FROM teams_messages WHERE created_at < ?").run(cutoff);
    this.db.prepare("DELETE FROM teams_messages_fts WHERE message_id NOT IN (SELECT message_id FROM teams_messages)").run();
  }

  searchMessages({
    query = "",
    top = 30,
    window = "30d",
    surface = "both",
    team = "",
    channel = "",
    sender = "",
    since = "",
    until = "",
    importance = ""
  }: SearchOptions = {}): TeamsSearchResult {
    this.initialize();
    const limit = clamp(top, 1, 100, 30);
    const windowSince = sinceIso(window);
    const sinceFilter = String(since ?? "").trim() || windowSince || "";
    const untilFilter = String(until ?? "").trim();
    const where: string[] = [];
    const params: Record<string, string | number> = {};

    if (surface === "chats") where.push("m.source_type = 'chat'");
    else if (surface === "channels") where.push("m.source_type = 'channel'");
    if (sinceFilter) {
      where.push("m.created_at >= :since");
      params.since = sinceFilter;
    }
    if (untilFilter) {
      where.push("m.created_at <= :until");
      params.until = untilFilter;
    }
    if (team) {
      where.push("(lower(coalesce(m.team_name, '')) LIKE :team OR lower(coalesce(m.chat_topic, '')) LIKE :team)");
      params.team = `%${String(team).toLowerCase()}%`;
    }
    if (channel) {
      where.push("lower(coalesce(m.channel_name, '')) LIKE :channel");
      params.channel = `%${String(channel).toLowerCase()}%`;
    }
    if (sender) {
      where.push("lower(coalesce(m.from_name, '')) LIKE :sender");
      params.sender = `%${String(sender).toLowerCase()}%`;
    }
    if (importance) {
      where.push("lower(coalesce(m.importance, '')) = :importance");
      params.importance = String(importance).toLowerCase();
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const q = String(query ?? "").trim();
    const tokens = tokenizeQuery(q);

    let rows: TeamsMessageRow[] = [];
    if (tokens.length > 0) {
      const matchQuery = tokens.map((t) => `${t}*`).join(" OR ");
      const stmt = this.db.prepare(`
        SELECT m.*
        FROM teams_messages m
        JOIN teams_messages_fts f ON f.message_id = m.message_id
        ${whereSql ? `${whereSql} AND` : "WHERE"} teams_messages_fts MATCH :q
        ORDER BY m.created_at DESC
        LIMIT :limit
      `);
      rows = stmt.all({ ...params, q: matchQuery, limit }) as unknown as TeamsMessageRow[];
    } else {
      const stmt = this.db.prepare(`
        SELECT m.*
        FROM teams_messages m
        ${whereSql}
        ORDER BY m.created_at DESC
        LIMIT :limit
      `);
      rows = stmt.all({ ...params, limit }) as unknown as TeamsMessageRow[];
    }

    const matched = rows.map(mapRow);
    const entityStmt = this.db.prepare(`
      SELECT entity_type, entity_id, label, team_name, channel_name, web_url
      FROM teams_entities
      WHERE lower(label) LIKE :term
      ORDER BY updated_at DESC
      LIMIT 5
    `);
    const fallbackMatches: TeamsFallbackMatch[] = q
      ? ((entityStmt.all({ term: `%${q.toLowerCase()}%` }) as unknown as TeamsEntityRow[]).map((e) => ({
          type: e.entity_type,
          id: e.entity_id,
          label: e.label,
          teamName: e.team_name ?? null,
          channelName: e.channel_name ?? null,
          webUrl: e.web_url ?? null,
          score: 1,
          why: "matched indexed workspace name"
        })))
      : [];

    const limitations: string[] = [];
    if (matched.length === 0 && fallbackMatches.length > 0) {
      const total = Number((this.countMessagesStmt.get() as CountRow | undefined)?.count ?? 0);
      if (total === 0) {
        limitations.push(
          "Local Teams message index currently has 0 retained messages (likely due retention window)."
        );
      }
    }

    const scopeStats = (this.statsScopeStmt.get() as ScopeStatsRow | undefined) ?? { chats: 0, channels: 0 };
    return {
      messages: matched,
      fallbackMatches,
      coverage: {
        chatsScanned: Number(scopeStats.chats ?? 0),
        chatMessagesScanned: Number(scopeStats.chats ?? 0),
        channelsScanned: Number(scopeStats.channels ?? 0),
        channelMessagesScanned: Number(scopeStats.channels ?? 0),
        totalCandidates: matched.length
      },
      limitations,
      sources: ["teams.local_index"]
    };
  }

  getMessageById(messageId: string): TeamsIndexedMessage | null {
    this.initialize();
    const row = this.getMessageByIdStmt.get(String(messageId ?? "").trim()) as TeamsMessageRow | undefined;
    return row ? mapRow(row) : null;
  }
}
