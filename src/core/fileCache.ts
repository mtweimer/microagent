import fs from "node:fs";
import path from "node:path";
import { InMemoryTranslationCache } from "./cache.js";
import type { DispatcherResponse } from "./contracts.js";

export class FileBackedTranslationCache extends InMemoryTranslationCache {
  filePath: string;

  constructor(filePath: string) {
    super();
    this.filePath = path.resolve(process.cwd(), filePath);
    this.load();
  }

  load(): void {
    if (!fs.existsSync(this.filePath)) return;
    const data = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Record<string, DispatcherResponse>;
    if (!data || typeof data !== "object") return;
    this.map = new Map(Object.entries(data));
  }

  override set(request: string, translation: DispatcherResponse): void {
    super.set(request, translation);
    this.save();
  }

  clear(): void {
    this.map.clear();
    this.save();
  }

  save(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(Object.fromEntries(this.map.entries()), null, 2));
  }
}
