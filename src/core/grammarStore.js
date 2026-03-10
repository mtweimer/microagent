import fs from "node:fs";
import path from "node:path";

export class FileBackedGrammarStore {
  constructor(filePath) {
    this.filePath = path.resolve(process.cwd(), filePath);
    this.rules = [];
    this.load();
  }

  load() {
    if (!fs.existsSync(this.filePath)) return;
    const data = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    if (!Array.isArray(data?.rules)) return;
    this.rules = data.rules;
  }

  learn(input, domain, envelope) {
    const tokens = tokenize(input);
    if (!tokens.length) return;
    this.rules.push({
      domain,
      tokens,
      envelope: {
        agent: envelope.agent,
        action: envelope.action,
        params: envelope.params ?? {},
        schemaVersion: envelope.schemaVersion
      },
      timestamp: new Date().toISOString()
    });
    if (this.rules.length > 2000) this.rules = this.rules.slice(-2000);
    this.save();
  }

  lookup(input, domain) {
    const queryTokens = tokenize(input);
    if (!queryTokens.length) return null;
    let best = null;
    let bestScore = 0;
    for (const rule of this.rules) {
      if (rule.domain !== domain) continue;
      const score = overlapScore(queryTokens, rule.tokens);
      if (score > bestScore) {
        bestScore = score;
        best = rule;
      }
    }
    if (!best || bestScore < 0.55) return null;
    return best.envelope;
  }

  clear() {
    this.rules = [];
    this.save();
  }

  stats() {
    return {
      rules: this.rules.length,
      filePath: this.filePath
    };
  }

  save() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify({ rules: this.rules }, null, 2));
  }
}

function tokenize(input) {
  return String(input ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => t.length > 2);
}

function overlapScore(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  let common = 0;
  for (const token of setA) if (setB.has(token)) common += 1;
  return common / Math.max(1, setA.size);
}
