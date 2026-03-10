import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MemoryStore } from "./contracts.js";

function normalize(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenize(text) {
  const t = normalize(text);
  if (!t) return [];
  return [...new Set(t.split(" "))];
}

function extractTopic(text) {
  const sentence = text.split(/[.!?]/)[0]?.trim() ?? text;
  return sentence.slice(0, 140);
}

function extractEntities(text) {
  const matches = text.match(/\b[A-Z][a-zA-Z0-9]+\b/g) ?? [];
  return [...new Set(matches)].slice(0, 12);
}

export class SQLiteStructuredMemory extends MemoryStore {
  constructor(dbPath) {
    super();
    this.dbPath = path.resolve(process.cwd(), dbPath);
    this.ready = false;
  }

  initialize() {
    if (this.ready) return;

    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new DatabaseSync(this.dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT DEFAULT 'default',
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        source_agent TEXT
      );
      CREATE TABLE IF NOT EXISTS topics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL,
        topic_text TEXT NOT NULL,
        salience_score REAL DEFAULT 1,
        FOREIGN KEY (message_id) REFERENCES messages(id)
      );
      CREATE TABLE IF NOT EXISTS entities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL,
        entity_text TEXT NOT NULL,
        entity_type TEXT DEFAULT 'unknown',
        normalized TEXT NOT NULL,
        FOREIGN KEY (message_id) REFERENCES messages(id)
      );
      CREATE TABLE IF NOT EXISTS terms_index (
        term TEXT NOT NULL,
        artifact_type TEXT NOT NULL,
        artifact_id INTEGER NOT NULL,
        weight REAL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS relations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL,
        subject TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object_text TEXT NOT NULL,
        FOREIGN KEY (message_id) REFERENCES messages(id)
      );
      CREATE INDEX IF NOT EXISTS idx_terms_term ON terms_index(term);
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
    `);

    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
          text,
          content='messages',
          content_rowid='id'
        );
      `);
      this.ftsEnabled = true;
    } catch {
      this.ftsEnabled = false;
    }

    this.insertMessageStmt = this.db.prepare(
      "INSERT INTO messages (role, text, timestamp, source_agent) VALUES (?, ?, ?, ?)"
    );
    this.insertTopicStmt = this.db.prepare(
      "INSERT INTO topics (message_id, topic_text, salience_score) VALUES (?, ?, ?)"
    );
    this.insertEntityStmt = this.db.prepare(
      "INSERT INTO entities (message_id, entity_text, entity_type, normalized) VALUES (?, ?, ?, ?)"
    );
    this.insertTermStmt = this.db.prepare(
      "INSERT INTO terms_index (term, artifact_type, artifact_id, weight) VALUES (?, ?, ?, ?)"
    );
    this.insertRelationStmt = this.db.prepare(
      "INSERT INTO relations (message_id, subject, predicate, object_text) VALUES (?, ?, ?, ?)"
    );
    this.insertFtsStmt = this.ftsEnabled
      ? this.db.prepare("INSERT INTO message_fts(rowid, text) VALUES (?, ?)")
      : null;

    this.searchTermsStmt = this.db.prepare(`
      SELECT artifact_id AS message_id, SUM(weight) AS score
      FROM terms_index
      WHERE artifact_type IN ('message', 'topic', 'entity', 'relation')
        AND term IN (
        SELECT value FROM json_each(?)
      )
      GROUP BY artifact_id
      ORDER BY score DESC, artifact_id DESC
      LIMIT ?
    `);

    this.searchMessagesByIdsStmt = this.db.prepare(
      "SELECT id, role, text, timestamp, source_agent FROM messages WHERE id = ?"
    );

    this.recentMessagesStmt = this.db.prepare(
      "SELECT id, role, text, timestamp, source_agent FROM messages ORDER BY id DESC LIMIT ?"
    );

    this.statsStmt = this.db.prepare("SELECT COUNT(*) AS count FROM messages");
    this.ready = true;
  }

  addTurn(turn) {
    this.initialize();

    const normalizedText = normalizeTurnText(turn.role, turn.text);
    const item = {
      role: turn.role,
      text: normalizedText,
      timestamp: turn.timestamp ?? new Date().toISOString(),
      source: turn.source ?? "chat"
    };

    const info = this.insertMessageStmt.run(item.role, item.text, item.timestamp, item.source);
    const messageId = Number(info.lastInsertRowid);

    const topic = extractTopic(item.text);
    this.insertTopicStmt.run(messageId, topic, 1);
    for (const term of tokenize(topic)) {
      this.insertTermStmt.run(term, "topic", messageId, 0.8);
    }

    for (const entity of extractEntities(item.text)) {
      this.insertEntityStmt.run(messageId, entity, "proper_noun", entity.toLowerCase());
      this.insertTermStmt.run(entity.toLowerCase(), "entity", messageId, 1.25);
    }

    for (const term of tokenize(item.text)) {
      this.insertTermStmt.run(term, "message", messageId, 1);
    }

    for (const relation of extractRelations(item.text)) {
      this.insertRelationStmt.run(messageId, relation.subject, relation.predicate, relation.object);
      this.insertTermStmt.run(normalize(relation.subject), "relation", messageId, 1.1);
      this.insertTermStmt.run(normalize(relation.object), "relation", messageId, 1.1);
      this.insertTermStmt.run(normalize(relation.predicate), "relation", messageId, 0.7);
    }

    if (this.insertFtsStmt) {
      this.insertFtsStmt.run(messageId, item.text);
    }

    return {
      id: messageId,
      role: item.role,
      text: item.text,
      timestamp: item.timestamp,
      source: item.source
    };
  }

  query(naturalLanguageQuery, options = {}) {
    this.initialize();

    const topK = options.topK ?? 5;
    const terms = tokenize(naturalLanguageQuery);
    const raw = this.searchTermsStmt.all(JSON.stringify(terms), topK);

    const results = raw.map((r) => {
      const row = this.searchMessagesByIdsStmt.get(r.message_id);
      return {
        id: row.id,
        role: row.role,
        text: row.text,
        timestamp: row.timestamp,
        source: row.source_agent,
        score: Number(r.score)
      };
    });

    if (results.length < topK) {
      const used = new Set(results.map((r) => r.id));
      const recent = this.recentMessagesStmt.all(topK * 2);
      for (const row of recent) {
        if (results.length >= topK) break;
        if (used.has(row.id)) continue;
        results.push({
          id: row.id,
          role: row.role,
          text: row.text,
          timestamp: row.timestamp,
          source: row.source_agent,
          score: 0
        });
      }
    }

    return {
      query: naturalLanguageQuery,
      terms,
      results
    };
  }

  stats() {
    this.initialize();
    return {
      backend: "sqlite",
      dbPath: this.dbPath,
      messages: Number(this.statsStmt.get().count),
      ftsEnabled: this.ftsEnabled
    };
  }
}

function extractRelations(text) {
  const rels = [];
  const mailMatch = text.match(/\b([A-Z][a-z]+)\s+(?:sent|emailed)\s+(.+?)\s+to\s+([A-Z][a-z]+)/i);
  if (mailMatch) {
    rels.push({
      subject: mailMatch[1],
      predicate: "sent_to",
      object: mailMatch[3]
    });
  }
  const meetMatch = text.match(/\b([A-Z][a-z]+)\s+met\s+with\s+([A-Z][a-z]+)/i);
  if (meetMatch) {
    rels.push({
      subject: meetMatch[1],
      predicate: "met_with",
      object: meetMatch[2]
    });
  }
  return rels;
}

function normalizeTurnText(role, text) {
  if (typeof text !== "string") return String(text ?? "");
  if (role !== "assistant") return text;
  return summarizeAssistantText(text);
}

function summarizeAssistantText(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return text;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return text;
  }

  const status = parsed.status ? `status=${parsed.status}` : null;
  const action = parsed.artifacts?.action;
  const actionSummary = action ? `${action.agent}.${action.action}` : null;
  const message = typeof parsed.message === "string" ? parsed.message : null;
  const provider = parsed.trace?.provider;
  const model = parsed.trace?.model;

  const parts = [
    "assistant_result",
    actionSummary,
    status,
    message,
    provider && model ? `provider=${provider} model=${model}` : null
  ].filter(Boolean);

  return parts.join(" | ");
}
