import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ActionEnvelope, AnyRecord } from "./contracts.js";

interface EntityRow {
  entity_id: number;
  entity_type: string;
  canonical_name: string;
  confidence?: number;
  first_seen_at?: string;
  last_seen_at?: string;
}

interface MentionRow {
  artifact_type: string;
  artifact_id: string;
  domain: string;
  timestamp: string;
  summary: string | null;
  metadata_json: string | null;
}

interface AliasRow {
  alias: string;
}

interface UpsertEntityOptions {
  timestamp?: string;
  entityType?: string;
  confidence?: number;
  metadata?: AnyRecord;
  source?: string;
}

interface ObservedEntity {
  entityId: number;
  canonicalName: string;
  entityType: string;
}

function normalize(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9@.\s&<>_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function inferEntityType(name: string): string {
  const text = String(name ?? "");
  if (/@/.test(text)) return "person";
  if (/\b(test|project|assessment|review|follow up|sync)\b/i.test(text)) return "project";
  if (/\b(llc|inc|consulting|bank|airways|museum|health|pharma|network)\b/i.test(text)) return "client";
  if (/\bteam|channel|chat\b/i.test(text)) return "workspace";
  if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+$/.test(text)) return "person";
  return "unknown";
}

function extractCapitalizedPhrases(text: unknown): string[] {
  const matches = String(text ?? "").match(/\b(?:[A-Z][a-z0-9&<>_-]+(?:\s+[A-Z][a-z0-9&<>_-]+){0,4})\b/g) ?? [];
  return [...new Set(matches.map(titleCase))].slice(0, 12);
}

function extractEmailNames(email: unknown): string[] {
  const value = String(email ?? "").trim();
  if (!value.includes("@")) return [];
  const local = value.split("@")[0] ?? "";
  const parts = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => `${p[0]?.toUpperCase() ?? ""}${p.slice(1)}`);
  const full = parts.join(" ").trim();
  return full ? [full, value] : [value];
}

function deriveAliases(name: string): string[] {
  const canonical = titleCase(name);
  const aliases = new Set([canonical]);
  const tokens = canonical.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    aliases.add(tokens[0] ?? canonical);
    const acronym = tokens.map((t) => t[0]).join("").toUpperCase();
    if (acronym.length >= 2) aliases.add(acronym);
  }
  return [...aliases];
}

function asRows(value: unknown): AnyRecord[] {
  return Array.isArray(value)
    ? value.filter((row): row is AnyRecord => typeof row === "object" && row !== null)
    : [];
}

function candidateNamesFromArtifact(envelope: ActionEnvelope | null | undefined, artifacts: AnyRecord): string[] {
  const names: unknown[] = [];
  const agent = envelope?.agent;
  if (agent === "ms.outlook") {
    for (const msg of asRows(artifacts.messages)) {
      names.push(...extractEmailNames(msg.from));
      names.push(msg.subject);
    }
    if (artifacts.from) names.push(...extractEmailNames(artifacts.from));
    if (artifacts.subject) names.push(artifacts.subject);
    if (artifacts.bodyPreview) names.push(...extractCapitalizedPhrases(artifacts.bodyPreview));
  } else if (agent === "ms.calendar") {
    for (const event of asRows(artifacts.events)) {
      names.push(event.subject, event.location, event.bodyPreview);
    }
  } else if (agent === "ms.teams") {
    for (const row of [...asRows(artifacts.prioritized), ...asRows(artifacts.hits), ...asRows(artifacts.mentions)]) {
      names.push(row.from, row.teamName, row.channelName, row.chatTopic, row.bodyPreview);
    }
    for (const row of asRows(artifacts.fallbackMatches)) {
      names.push(row.label, row.teamName, row.channelName);
    }
  }
  return [...new Set(names.flatMap((name) => {
    if (!name) return [];
    const base = titleCase(name);
    const caps = extractCapitalizedPhrases(base);
    return [base, ...caps];
  }).filter(Boolean as unknown as (value: string) => boolean))].slice(0, 24);
}

function summarizeArtifact(envelope: ActionEnvelope | null | undefined, artifacts: AnyRecord): string {
  if (envelope?.agent === "ms.outlook") {
    if (typeof artifacts.subject === "string") return `Email: ${artifacts.subject}`;
    const firstMessage = asRows(artifacts.messages)[0];
    if (typeof firstMessage?.subject === "string") return `Email search: ${firstMessage.subject}`;
  }
  if (envelope?.agent === "ms.calendar") {
    const firstEvent = asRows(artifacts.events)[0];
    if (typeof firstEvent?.subject === "string") return `Calendar: ${firstEvent.subject}`;
  }
  if (envelope?.agent === "ms.teams") {
    const firstHit = asRows(artifacts.hits)[0];
    if (typeof firstHit?.teamName === "string") return `Teams: ${firstHit.teamName}`;
    const firstFallback = asRows(artifacts.fallbackMatches)[0];
    if (typeof firstFallback?.label === "string") return `Teams workspace: ${firstFallback.label}`;
  }
  return `${envelope?.agent ?? "artifact"}:${envelope?.action ?? "unknown"}`;
}

function safeJson(text: string | null | undefined): AnyRecord {
  try {
    return JSON.parse(text ?? "{}") as AnyRecord;
  } catch {
    return {};
  }
}

export class EntityGraph {
  dbPath: string;
  ready: boolean;
  db!: DatabaseSync;
  selectEntityByNormStmt!: ReturnType<DatabaseSync["prepare"]>;
  selectEntityByAliasStmt!: ReturnType<DatabaseSync["prepare"]>;
  insertEntityStmt!: ReturnType<DatabaseSync["prepare"]>;
  updateEntityStmt!: ReturnType<DatabaseSync["prepare"]>;
  insertAliasStmt!: ReturnType<DatabaseSync["prepare"]>;
  insertMentionStmt!: ReturnType<DatabaseSync["prepare"]>;
  insertArtifactRefStmt!: ReturnType<DatabaseSync["prepare"]>;
  recentEntitiesStmt!: ReturnType<DatabaseSync["prepare"]>;
  lookupMentionsStmt!: ReturnType<DatabaseSync["prepare"]>;

  constructor(dbPath: string) {
    this.dbPath = path.resolve(process.cwd(), dbPath);
    this.ready = false;
  }

  initialize(): void {
    if (this.ready) return;
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        entity_id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL,
        canonical_name TEXT NOT NULL,
        normalized_name TEXT NOT NULL UNIQUE,
        confidence REAL DEFAULT 0.5,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        metadata_json TEXT DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS entity_aliases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_id INTEGER NOT NULL,
        alias TEXT NOT NULL,
        normalized_alias TEXT NOT NULL,
        confidence REAL DEFAULT 0.5,
        source TEXT,
        UNIQUE(entity_id, normalized_alias)
      );
      CREATE TABLE IF NOT EXISTS entity_edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_entity_id INTEGER NOT NULL,
        edge_type TEXT NOT NULL,
        to_entity_id INTEGER NOT NULL,
        confidence REAL DEFAULT 0.5,
        source TEXT,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        UNIQUE(from_entity_id, edge_type, to_entity_id)
      );
      CREATE TABLE IF NOT EXISTS entity_mentions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_id INTEGER NOT NULL,
        artifact_type TEXT NOT NULL,
        artifact_id TEXT NOT NULL,
        domain TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        confidence REAL DEFAULT 0.5,
        UNIQUE(entity_id, artifact_type, artifact_id)
      );
      CREATE TABLE IF NOT EXISTS artifact_refs (
        ref_id TEXT PRIMARY KEY,
        artifact_type TEXT NOT NULL,
        artifact_id TEXT NOT NULL,
        domain TEXT NOT NULL,
        summary TEXT,
        timestamp TEXT NOT NULL,
        metadata_json TEXT DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_entity_alias_norm ON entity_aliases(normalized_alias);
      CREATE INDEX IF NOT EXISTS idx_entity_mentions_ts ON entity_mentions(timestamp DESC);
    `);
    this.selectEntityByNormStmt = this.db.prepare("SELECT * FROM entities WHERE normalized_name = ?");
    this.selectEntityByAliasStmt = this.db.prepare(`
      SELECT e.*
      FROM entity_aliases a
      JOIN entities e ON e.entity_id = a.entity_id
      WHERE a.normalized_alias = ?
      ORDER BY a.confidence DESC, e.last_seen_at DESC
      LIMIT 1
    `);
    this.insertEntityStmt = this.db.prepare(`
      INSERT INTO entities (entity_type, canonical_name, normalized_name, confidence, first_seen_at, last_seen_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    this.updateEntityStmt = this.db.prepare(`
      UPDATE entities
      SET canonical_name = ?, entity_type = ?, confidence = ?, last_seen_at = ?, metadata_json = ?
      WHERE entity_id = ?
    `);
    this.insertAliasStmt = this.db.prepare(`
      INSERT OR IGNORE INTO entity_aliases (entity_id, alias, normalized_alias, confidence, source)
      VALUES (?, ?, ?, ?, ?)
    `);
    this.insertMentionStmt = this.db.prepare(`
      INSERT OR IGNORE INTO entity_mentions (entity_id, artifact_type, artifact_id, domain, timestamp, confidence)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    this.insertArtifactRefStmt = this.db.prepare(`
      INSERT INTO artifact_refs (ref_id, artifact_type, artifact_id, domain, summary, timestamp, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(ref_id) DO UPDATE SET
        artifact_type=excluded.artifact_type,
        artifact_id=excluded.artifact_id,
        domain=excluded.domain,
        summary=excluded.summary,
        timestamp=excluded.timestamp,
        metadata_json=excluded.metadata_json
    `);
    this.recentEntitiesStmt = this.db.prepare(`
      SELECT entity_id, entity_type, canonical_name, confidence, first_seen_at, last_seen_at
      FROM entities
      ORDER BY last_seen_at DESC, entity_id DESC
      LIMIT ?
    `);
    this.lookupMentionsStmt = this.db.prepare(`
      SELECT m.artifact_type, m.artifact_id, m.domain, m.timestamp, a.summary, a.metadata_json
      FROM entity_mentions m
      LEFT JOIN artifact_refs a ON a.artifact_id = m.artifact_id
      WHERE m.entity_id = ?
      ORDER BY m.timestamp DESC
      LIMIT ?
    `);
    this.ready = true;
  }

  upsertEntity(name: string, options: UpsertEntityOptions = {}): ObservedEntity | null {
    this.initialize();
    const canonical = titleCase(name);
    const normalized = normalize(canonical);
    if (!normalized) return null;
    const now = options.timestamp ?? new Date().toISOString();
    const entityType = options.entityType ?? inferEntityType(canonical);
    const confidence = Number(options.confidence ?? 0.6);
    const metadata = JSON.stringify(options.metadata ?? {});
    let row = (this.selectEntityByNormStmt.get(normalized) as EntityRow | undefined) ??
      (this.selectEntityByAliasStmt.get(normalized) as EntityRow | undefined);
    if (!row) {
      const info = this.insertEntityStmt.run(entityType, canonical, normalized, confidence, now, now, metadata);
      row = { entity_id: Number(info.lastInsertRowid), canonical_name: canonical, entity_type: entityType };
    } else {
      this.updateEntityStmt.run(
        canonical || row.canonical_name,
        entityType || row.entity_type,
        Math.max(confidence, Number(row.confidence ?? 0.5)),
        now,
        metadata,
        row.entity_id
      );
    }
    for (const alias of deriveAliases(canonical)) {
      this.insertAliasStmt.run(
        row.entity_id,
        alias,
        normalize(alias),
        confidence,
        options.source ?? "observe"
      );
    }
    return {
      entityId: row.entity_id,
      canonicalName: canonical,
      entityType
    };
  }

  observeExecution(envelope: ActionEnvelope | null | undefined, artifacts: AnyRecord = {}): ObservedEntity[] {
    this.initialize();
    const now = new Date().toISOString();
    const artifactId = String(
      artifacts.id ??
        asRows(artifacts.events)[0]?.webLink ??
        asRows(artifacts.messages)[0]?.id ??
        asRows(artifacts.hits)[0]?.id ??
        asRows(artifacts.prioritized)[0]?.id ??
        `${envelope?.agent ?? "artifact"}:${envelope?.action ?? "unknown"}:${now}`
    );
    const artifactType = envelope?.action ?? "artifact";
    const domain = envelope?.agent ?? "unknown";
    this.insertArtifactRefStmt.run(
      `${domain}:${artifactId}`,
      artifactType,
      artifactId,
      domain,
      summarizeArtifact(envelope, artifacts),
      now,
      JSON.stringify({
        agent: envelope?.agent ?? null,
        action: envelope?.action ?? null
      })
    );
    const entities = candidateNamesFromArtifact(envelope, artifacts);
    const observed: ObservedEntity[] = [];
    for (const name of entities) {
      const entity = this.upsertEntity(name, {
        timestamp: now,
        source: domain,
        confidence: 0.65
      });
      if (!entity) continue;
      this.insertMentionStmt.run(entity.entityId, artifactType, artifactId, domain, now, 0.65);
      observed.push(entity);
    }
    return observed;
  }

  lookup(name: string, limit = 10): { query: string; entities: Array<{ entityId: number; name: string; entityType: string; confidence: number; mentions: AnyRecord[] }> } {
    this.initialize();
    const normalized = normalize(name);
    if (!normalized) return { query: name, entities: [] };
    const entity = (this.selectEntityByNormStmt.get(normalized) as EntityRow | undefined) ??
      (this.selectEntityByAliasStmt.get(normalized) as EntityRow | undefined);
    if (!entity) return { query: name, entities: [] };
    const mentions = (this.lookupMentionsStmt.all(entity.entity_id, limit) as unknown as MentionRow[]).map((row) => ({
      artifactType: row.artifact_type,
      artifactId: row.artifact_id,
      domain: row.domain,
      timestamp: row.timestamp,
      summary: row.summary,
      metadata: safeJson(row.metadata_json)
    }));
    return {
      query: name,
      entities: [
        {
          entityId: entity.entity_id,
          name: entity.canonical_name,
          entityType: entity.entity_type,
          confidence: Number(entity.confidence ?? 0.5),
          mentions
        }
      ]
    };
  }

  recent(limit = 10): Array<{ entityId: number; name: string; entityType: string; confidence: number; firstSeenAt: string | undefined; lastSeenAt: string | undefined }> {
    this.initialize();
    return (this.recentEntitiesStmt.all(limit) as unknown as EntityRow[]).map((row) => ({
      entityId: row.entity_id,
      name: row.canonical_name,
      entityType: row.entity_type,
      confidence: Number(row.confidence ?? 0.5),
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at
    }));
  }

  aliasesFor(name: string): string[] {
    this.initialize();
    const normalized = normalize(name);
    if (!normalized) return [];
    const entity = (this.selectEntityByNormStmt.get(normalized) as EntityRow | undefined) ??
      (this.selectEntityByAliasStmt.get(normalized) as EntityRow | undefined);
    if (!entity) return deriveAliases(name);
    const rows = this.db
      .prepare("SELECT alias FROM entity_aliases WHERE entity_id = ? ORDER BY confidence DESC, id ASC")
      .all(entity.entity_id) as unknown as AliasRow[];
    const aliases = rows.map((row) => row.alias).filter(Boolean);
    return aliases.length > 0 ? aliases : deriveAliases(entity.canonical_name);
  }
}
