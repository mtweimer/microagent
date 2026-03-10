// @ts-nocheck
import { MemoryStore } from "./contracts.js";

function normalize(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenize(text) {
  const t = normalize(text);
  if (!t) return [];
  return [...new Set(t.split(" "))];
}

/**
 * Minimal structured memory:
 * - stores turns
 * - builds an inverted term index
 * - supports basic query by term overlap
 */
export class StructuredTurnMemory extends MemoryStore {
  constructor() {
    super();
    this.turns = [];
    this.termToTurnIds = new Map();
  }

  addTurn(turn) {
    const id = this.turns.length;
    const item = {
      id,
      role: turn.role,
      text: turn.text,
      timestamp: turn.timestamp ?? new Date().toISOString(),
      source: turn.source ?? "chat"
    };
    this.turns.push(item);

    const terms = tokenize(item.text);
    for (const term of terms) {
      if (!this.termToTurnIds.has(term)) this.termToTurnIds.set(term, new Set());
      this.termToTurnIds.get(term).add(id);
    }

    return item;
  }

  query(naturalLanguageQuery, options = {}) {
    const topK = options.topK ?? 5;
    const terms = tokenize(naturalLanguageQuery);
    const scores = new Map();

    for (const term of terms) {
      const ids = this.termToTurnIds.get(term);
      if (!ids) continue;
      for (const id of ids) {
        scores.set(id, (scores.get(id) ?? 0) + 1);
      }
    }

    let ranked = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([id, score]) => ({ ...this.turns[id], score }));

    // Add recent turns as supporting context so broad queries can still surface
    // relevant nearby facts even when lexical overlap is sparse.
    const used = new Set(ranked.map((r) => r.id));
    for (const turn of [...this.turns].reverse()) {
      if (ranked.length >= topK) break;
      if (used.has(turn.id)) continue;
      ranked.push({ ...turn, score: 0 });
    }

    return {
      query: naturalLanguageQuery,
      terms,
      results: ranked
    };
  }
}
