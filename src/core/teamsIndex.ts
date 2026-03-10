// @ts-nocheck
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fetchTeamsMessages } from "../agents/teams/actions/_teamsGraph.js";

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function sinceIso(window) {
  const now = new Date();
  const lower = String(window ?? "today").toLowerCase();
  if (lower === "all") return null;
  if (lower === "30d") return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  if (lower === "7d") return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  if (lower === "48h") return new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).toISOString();
}

function tokenizeQuery(query) {
  return String(query ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function mapRow(row) {
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

export class TeamsIndex {
  constructor({
    dbPath = "./data/teams-index.sqlite",
    retentionDays = 180,
    deltaLookbackHours = 6,
    deltaIntervalMs = 5 * 60 * 1000
  } = {}) {
    this.dbPath = path.resolve(process.cwd(), dbPath);
    this.retentionDays = clamp(retentionDays, 30, 3650, 180);
    this.deltaLookbackHours = clamp(deltaLookbackHours, 1, 168, 6);
    this.ready = false;
    this.syncIntervalMs = clamp(deltaIntervalMs, 60 * 1000, 24 * 60 * 60 * 1000, 10 * 60 * 1000);
    this.staleThresholdMs = 30 * 60 * 1000;
  }

  initialize() {
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

  getConfig() {
    return {
      dbPath: this.dbPath,
      retentionDays: this.retentionDays,
      deltaLookbackHours: this.deltaLookbackHours,
      syncIntervalMs: this.syncIntervalMs,
      staleThresholdMs: this.staleThresholdMs
    };
  }

  getStatus() {
    this.initialize();
    const messages = Number(this.countMessagesStmt.get()?.count ?? 0);
    const latestCreated = this.latestCreatedStmt.get()?.created ?? null;
    const checkpoint = this.getCheckpointStmt.get("teams") ?? null;
    const syncState = this.getSyncStateStmt.get("teams") ?? null;
    const scope = this.statsScopeStmt.get() ?? { chats: 0, channels: 0 };
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

  async syncFromGraph(
    graphClient,
    { top = 100, surface = "both", depth = "deep", window = "all", mode = "full", deltaSinceIso = "", deltaLookbackHours } = {}
  ) {
    this.initialize();
    const startedAt = new Date().toISOString();
    const safeTop = clamp(top, 1, 5000, 100);
    const normalizedMode = String(mode ?? "full").toLowerCase() === "delta" ? "delta" : "full";
    const checkpoint = this.getCheckpointStmt.get("teams") ?? null;
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
      const result = await fetchTeamsMessages(graphClient, {
        top: safeTop,
        surface,
        depth,
        window: normalizedMode === "delta" ? "all" : window,
        query: "",
        since: deltaSince
      });
      const now = new Date().toISOString();
      const beforeCount = Number(this.countMessagesStmt.get()?.count ?? 0);
      let upserts = 0;
      let updates = 0;
      let unchanged = 0;
      for (const row of result.messages ?? []) {
        const existing = this.getMessageByIdStmt.get(row.id);
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
      const afterCount = Number(this.countMessagesStmt.get()?.count ?? 0);
      const indexed = result.messages?.length ?? 0;
      const retainedFromThisRun = Math.max(0, afterCount - beforeCount);
      const droppedByRetention = Math.max(0, indexed - retainedFromThisRun);
      const latestSeen = maxTimestamp(result.messages?.map((m) => m.createdDateTime).filter(Boolean));
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
      const msg = String(error?.message ?? error);
      this.upsertCheckpointStmt.run("teams", checkpoint?.cursor_or_time ?? startedAt, null, msg);
      return {
        status: "error",
        message: `Teams sync failed: ${msg}`
      };
    }
  }

  pruneRetention() {
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
  } = {}) {
    this.initialize();
    const limit = clamp(top, 1, 100, 30);
    const windowSince = sinceIso(window);
    const sinceFilter = String(since ?? "").trim() || windowSince || "";
    const untilFilter = String(until ?? "").trim();
    const where = [];
    const params = {};

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

    let rows = [];
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
      rows = stmt.all({ ...params, q: matchQuery, limit });
    } else {
      const stmt = this.db.prepare(`
        SELECT m.*
        FROM teams_messages m
        ${whereSql}
        ORDER BY m.created_at DESC
        LIMIT :limit
      `);
      rows = stmt.all({ ...params, limit });
    }

    const matched = rows.map(mapRow);
    const entityStmt = this.db.prepare(`
      SELECT entity_type, entity_id, label, team_name, channel_name, web_url
      FROM teams_entities
      WHERE lower(label) LIKE :term
      ORDER BY updated_at DESC
      LIMIT 5
    `);
    const fallbackMatches = q
      ? entityStmt
          .all({ term: `%${q.toLowerCase()}%` })
          .map((e) => ({
            type: e.entity_type,
            id: e.entity_id,
            label: e.label,
            teamName: e.team_name ?? null,
            channelName: e.channel_name ?? null,
            webUrl: e.web_url ?? null,
            score: 1,
            why: "matched indexed workspace name"
          }))
      : [];

    const limitations = [];
    if (matched.length === 0 && fallbackMatches.length > 0) {
      const total = Number(this.countMessagesStmt.get()?.count ?? 0);
      if (total === 0) {
        limitations.push(
          "Local Teams message index currently has 0 retained messages (likely due retention window)."
        );
      }
    }

    return {
      messages: matched,
      fallbackMatches,
      coverage: {
        chatsScanned: Number(this.statsScopeStmt.get()?.chats ?? 0),
        chatMessagesScanned: Number(this.statsScopeStmt.get()?.chats ?? 0),
        channelsScanned: Number(this.statsScopeStmt.get()?.channels ?? 0),
        channelMessagesScanned: Number(this.statsScopeStmt.get()?.channels ?? 0),
        totalCandidates: matched.length
      },
      limitations,
      sources: ["teams.local_index"]
    };
  }

  getMessageById(messageId) {
    this.initialize();
    const row = this.getMessageByIdStmt.get(String(messageId ?? "").trim());
    return row ? mapRow(row) : null;
  }
}

function isSameMessage(existing, row) {
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

function maxTimestamp(values = []) {
  let max = 0;
  for (const value of values) {
    const ts = new Date(value).getTime();
    if (!Number.isNaN(ts) && ts > max) max = ts;
  }
  if (!max) return "";
  return new Date(max).toISOString();
}
