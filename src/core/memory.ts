import { MemoryStore } from "./contracts.js";
import type { MemoryQueryHit, MemoryQueryOptions, MemoryQueryResult, MemoryTurn } from "./contracts.js";

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenize(text: string): string[] {
  const t = normalize(text);
  if (!t) return [];
  return [...new Set(t.split(" ").filter(Boolean))];
}

export class StructuredTurnMemory extends MemoryStore {
  turns: MemoryQueryHit[];
  termToTurnIds: Map<string, Set<number>>;

  constructor() {
    super();
    this.turns = [];
    this.termToTurnIds = new Map();
  }

  override addTurn(turn: MemoryTurn & { timestamp?: string }): MemoryQueryHit {
    const id = this.turns.length;
    const item: MemoryQueryHit = {
      id,
      role: turn.role,
      text: turn.text,
      timestamp: turn.timestamp ?? new Date().toISOString(),
      source: turn.source ?? "chat"
    };
    this.turns.push(item);

    const terms = tokenize(String(item.text ?? ""));
    for (const term of terms) {
      if (!this.termToTurnIds.has(term)) this.termToTurnIds.set(term, new Set());
      this.termToTurnIds.get(term)?.add(id);
    }

    return item;
  }

  override query(naturalLanguageQuery: string, options: MemoryQueryOptions = {}): MemoryQueryResult {
    const topK = typeof options.topK === "number" ? options.topK : 5;
    const excluded = new Set((options.excludeIds ?? []).map((value) => String(value)));
    const terms = tokenize(naturalLanguageQuery);
    const scores = new Map<number, number>();

    for (const term of terms) {
      const ids = this.termToTurnIds.get(term);
      if (!ids) continue;
      for (const id of ids) {
        scores.set(id, (scores.get(id) ?? 0) + 1);
      }
    }

    const ranked: MemoryQueryHit[] = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .flatMap(([id, score]) => {
        const turn = this.turns[id];
        if (!turn || excluded.has(String(turn.id))) return [];
        return [{ ...turn, score }];
      });

    const used = new Set(ranked.map((r) => r.id));
    for (const turn of [...this.turns].reverse()) {
      if (ranked.length >= topK) break;
      if (used.has(turn.id)) continue;
      if (excluded.has(String(turn.id))) continue;
      ranked.push({ ...turn, score: 0 });
    }

    return { results: ranked };
  }
}
