import fs from "node:fs";
import path from "node:path";

function isoDay(ts) {
  return new Date(ts ?? Date.now()).toISOString().slice(0, 10);
}

export class NarrativeMemory {
  constructor(filePath = "./data/narrative-default.jsonl") {
    this.filePath = path.resolve(process.cwd(), filePath);
    this.entries = [];
    this.loaded = false;
  }

  load() {
    if (this.loaded) return;
    this.loaded = true;
    if (!fs.existsSync(this.filePath)) return;
    const lines = fs.readFileSync(this.filePath, "utf8").split("\n").filter(Boolean);
    this.entries = lines.map((line) => safeJson(line)).filter(Boolean);
  }

  append(entry) {
    this.load();
    const normalized = {
      timestamp: entry.timestamp ?? new Date().toISOString(),
      day: isoDay(entry.timestamp),
      kind: entry.kind ?? "summary",
      text: entry.text ?? "",
      metadata: entry.metadata ?? {}
    };
    this.entries.push(normalized);
    this.persist(normalized);
    return normalized;
  }

  summarize(range = "today", limit = 20) {
    this.load();
    const now = new Date();
    const rows = [];
    for (let i = this.entries.length - 1; i >= 0; i -= 1) {
      const entry = this.entries[i];
      if (!inRange(entry.timestamp, range, now)) continue;
      rows.push(entry);
      if (rows.length >= limit) break;
    }
    return rows;
  }

  stats() {
    this.load();
    return {
      entries: this.entries.length,
      filePath: this.filePath
    };
  }

  persist(entry) {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`);
  }
}

function inRange(ts, range, now) {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return false;
  if (range === "session") return true;
  if (range === "today") return isoDay(date) === isoDay(now);
  if (range === "week") return date.getTime() >= now.getTime() - 7 * 24 * 60 * 60 * 1000;
  return true;
}

function safeJson(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
