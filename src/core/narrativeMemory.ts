import fs from "node:fs";
import path from "node:path";
import type { AnyRecord } from "./contracts.js";

interface NarrativeEntry {
  timestamp: string;
  day: string;
  kind: string;
  text: string;
  metadata: AnyRecord;
}

function isoDay(ts: string | number | Date | undefined): string {
  return new Date(ts ?? Date.now()).toISOString().slice(0, 10);
}

export class NarrativeMemory {
  filePath: string;
  entries: NarrativeEntry[];
  loaded: boolean;

  constructor(filePath = "./data/narrative-default.jsonl") {
    this.filePath = path.resolve(process.cwd(), filePath);
    this.entries = [];
    this.loaded = false;
  }

  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!fs.existsSync(this.filePath)) return;
    const lines = fs.readFileSync(this.filePath, "utf8").split("\n").filter(Boolean);
    this.entries = lines.map((line) => safeJson(line)).filter((entry): entry is NarrativeEntry => entry !== null);
  }

  append(entry: Partial<NarrativeEntry> & { text: string; kind: string }): NarrativeEntry {
    this.load();
    const normalized: NarrativeEntry = {
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

  summarize(range = "today", limit = 20): NarrativeEntry[] {
    this.load();
    const now = new Date();
    const rows: NarrativeEntry[] = [];
    for (let i = this.entries.length - 1; i >= 0; i -= 1) {
      const entry = this.entries[i];
      if (!entry || !inRange(entry.timestamp, range, now)) continue;
      rows.push(entry);
      if (rows.length >= limit) break;
    }
    return rows;
  }

  stats(): { entries: number; filePath: string } {
    this.load();
    return {
      entries: this.entries.length,
      filePath: this.filePath
    };
  }

  persist(entry: NarrativeEntry): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`);
  }
}

function inRange(ts: string, range: string, now: Date): boolean {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return false;
  if (range === "session") return true;
  if (range === "today") return isoDay(date) === isoDay(now);
  if (range === "week") return date.getTime() >= now.getTime() - 7 * 24 * 60 * 60 * 1000;
  return true;
}

function safeJson(line: string): NarrativeEntry | null {
  try {
    return JSON.parse(line) as NarrativeEntry;
  } catch {
    return null;
  }
}
