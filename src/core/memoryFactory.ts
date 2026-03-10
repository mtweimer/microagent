import { StructuredTurnMemory } from "./memory.js";
import { SQLiteStructuredMemory } from "./sqliteMemory.js";
import type { MicroClawProfile } from "./profile.js";

export function createMemoryStore(profile: MicroClawProfile): StructuredTurnMemory | SQLiteStructuredMemory {
  const backend = profile?.memory?.backend ?? "inmemory";
  if (backend === "sqlite") {
    try {
      return new SQLiteStructuredMemory(String(profile.memory?.dbPath ?? "./data/memory.sqlite"));
    } catch {
      return new StructuredTurnMemory();
    }
  }
  return new StructuredTurnMemory();
}
