import fs from "node:fs";
import path from "node:path";

const NORMALIZE_PATTERNS = [
  [/\b(fetch|get|retrieve|show|list|find|search|read|review|examine)\b/g, "read"],
  [/\b(latest|recent)\b/g, "latest"],
  [/\b(last)\s+\d{1,2}\b/g, "latest"],
  [/[0-9]+/g, "N"]
];

export class FileBackedPatternCache {
  constructor(filePath) {
    this.filePath = path.resolve(process.cwd(), filePath);
    this.map = new Map();
    this.load();
  }

  load() {
    if (!fs.existsSync(this.filePath)) return;
    const data = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    if (!data || typeof data !== "object") return;
    this.map = new Map(Object.entries(data));
  }

  lookup(input, domain) {
    const key = keyFor(input, domain);
    return this.map.get(key);
  }

  learn(input, domain, envelope) {
    const key = keyFor(input, domain);
    const stored = {
      agent: envelope.agent,
      action: envelope.action,
      params: envelope.params ?? {},
      schemaVersion: envelope.schemaVersion
    };
    this.map.set(key, stored);
    this.save();
  }

  clear() {
    this.map.clear();
    this.save();
  }

  stats() {
    return {
      size: this.map.size,
      filePath: this.filePath
    };
  }

  save() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(Object.fromEntries(this.map.entries()), null, 2));
  }
}

function keyFor(input, domain) {
  return `${domain}::${canonicalize(input)}`;
}

function canonicalize(input) {
  let text = String(input ?? "").toLowerCase().trim();
  for (const [pattern, replace] of NORMALIZE_PATTERNS) {
    text = text.replace(pattern, replace);
  }
  text = text.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  return text;
}
