import fs from "node:fs";
import path from "node:path";
import type { ActionEnvelope, AnyRecord } from "./contracts.js";

const NORMALIZE_PATTERNS: Array<[RegExp, string]> = [
  [/\b(fetch|get|retrieve|show|list|find|search|read|review|examine)\b/g, "read"],
  [/\b(latest|recent)\b/g, "latest"],
  [/\b(last)\s+\d{1,2}\b/g, "latest"],
  [/[0-9]+/g, "N"]
];

interface StoredPatternEnvelope {
  agent: string;
  action: string;
  params: AnyRecord;
  schemaVersion?: string;
}

export class FileBackedPatternCache {
  filePath: string;
  map: Map<string, StoredPatternEnvelope>;

  constructor(filePath: string) {
    this.filePath = path.resolve(process.cwd(), filePath);
    this.map = new Map();
    this.load();
  }

  load(): void {
    if (!fs.existsSync(this.filePath)) return;
    const data = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Record<string, StoredPatternEnvelope>;
    if (!data || typeof data !== "object") return;
    this.map = new Map(Object.entries(data));
  }

  lookup(input: string, domain: string | null): StoredPatternEnvelope | undefined {
    const key = keyFor(input, domain);
    return this.map.get(key);
  }

  learn(input: string, domain: string | null, envelope: ActionEnvelope): void {
    const key = keyFor(input, domain);
    const stored: StoredPatternEnvelope = {
      agent: envelope.agent,
      action: envelope.action,
      params: envelope.params ?? {},
      schemaVersion: envelope.schemaVersion
    };
    this.map.set(key, stored);
    this.save();
  }

  clear(): void {
    this.map.clear();
    this.save();
  }

  stats(): { size: number; filePath: string } {
    return {
      size: this.map.size,
      filePath: this.filePath
    };
  }

  save(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(Object.fromEntries(this.map.entries()), null, 2));
  }
}

function keyFor(input: string, domain: string | null): string {
  return `${domain}::${canonicalize(input)}`;
}

function canonicalize(input: string): string {
  let text = String(input ?? "").toLowerCase().trim();
  for (const [pattern, replace] of NORMALIZE_PATTERNS) {
    text = text.replace(pattern, replace);
  }
  text = text.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  return text;
}
