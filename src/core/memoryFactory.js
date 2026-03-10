import { StructuredTurnMemory } from "./memory.js";
import { SQLiteStructuredMemory } from "./sqliteMemory.js";

export function createMemoryStore(profile) {
  const backend = profile?.memory?.backend ?? "inmemory";
  if (backend === "sqlite") {
    try {
      return new SQLiteStructuredMemory(profile.memory.dbPath);
    } catch {
      return new StructuredTurnMemory();
    }
  }
  return new StructuredTurnMemory();
}
