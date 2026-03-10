import fs from "node:fs";
import path from "node:path";
import { InMemoryTranslationCache } from "./cache.js";

export class FileBackedTranslationCache extends InMemoryTranslationCache {
  constructor(filePath) {
    super();
    this.filePath = path.resolve(process.cwd(), filePath);
    this.load();
  }

  load() {
    if (!fs.existsSync(this.filePath)) return;
    const data = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    if (!data || typeof data !== "object") return;
    this.map = new Map(Object.entries(data));
  }

  set(request, translation) {
    super.set(request, translation);
    this.save();
  }

  clear() {
    this.map.clear();
    this.save();
  }

  save() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(Object.fromEntries(this.map.entries()), null, 2));
  }
}
