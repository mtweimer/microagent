import { TranslationCache } from "./contracts.js";
import type { DispatcherResponse } from "./contracts.js";

export class InMemoryTranslationCache extends TranslationCache {
  map: Map<string, DispatcherResponse>;
  hits: number;
  misses: number;

  constructor() {
    super();
    this.map = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  override get(request: string): DispatcherResponse | null {
    if (this.map.has(request)) {
      this.hits += 1;
      return this.map.get(request) ?? null;
    }
    this.misses += 1;
    return null;
  }

  override set(request: string, translation: DispatcherResponse): void {
    this.map.set(request, translation);
  }

  stats(): { size: number; hits: number; misses: number; hitRate: number } {
    return {
      size: this.map.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses === 0 ? 0 : this.hits / (this.hits + this.misses)
    };
  }
}
