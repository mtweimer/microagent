import { TranslationCache } from "./contracts.js";

export class InMemoryTranslationCache extends TranslationCache {
  constructor() {
    super();
    this.map = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  get(request) {
    if (this.map.has(request)) {
      this.hits += 1;
      return this.map.get(request);
    }
    this.misses += 1;
    return undefined;
  }

  set(request, translation) {
    this.map.set(request, translation);
  }

  stats() {
    return {
      size: this.map.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses === 0 ? 0 : this.hits / (this.hits + this.misses)
    };
  }
}
