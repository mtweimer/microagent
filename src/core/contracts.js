/**
 * Core contracts for micro-claw.
 * These are intentionally minimal and map to TypeAgent concepts:
 * dispatcher, cache, memory, and pluggable providers/agents.
 */

export class ModelProvider {
  constructor(name) {
    this.name = name;
  }

  // eslint-disable-next-line no-unused-vars
  async complete(_messages, _options = {}) {
    throw new Error(`Provider ${this.name} must implement complete()`);
  }
}

export class Agent {
  constructor(id, description) {
    this.id = id;
    this.description = description;
  }

  // eslint-disable-next-line no-unused-vars
  async canHandle(_input) {
    return false;
  }

  // eslint-disable-next-line no-unused-vars
  async handle(_input, _context) {
    throw new Error(`Agent ${this.id} must implement handle()`);
  }
}

export class MemoryStore {
  // eslint-disable-next-line no-unused-vars
  addTurn(_turn) {
    throw new Error("MemoryStore.addTurn() not implemented");
  }

  // eslint-disable-next-line no-unused-vars
  query(_naturalLanguageQuery, _options = {}) {
    throw new Error("MemoryStore.query() not implemented");
  }
}

export class TranslationCache {
  // eslint-disable-next-line no-unused-vars
  get(_request) {
    throw new Error("TranslationCache.get() not implemented");
  }

  // eslint-disable-next-line no-unused-vars
  set(_request, _translation) {
    throw new Error("TranslationCache.set() not implemented");
  }
}
