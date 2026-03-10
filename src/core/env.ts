import fs from "node:fs";
import path from "node:path";

export interface EnvLoadResult {
  filePath: string;
  loaded: string[];
  exists: boolean;
}

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseDotEnv(content: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    if (!key) continue;

    const value = stripWrappingQuotes(line.slice(eq + 1));
    parsed[key] = value;
  }

  return parsed;
}

export function loadEnvFile(filePath = ".env", env: NodeJS.ProcessEnv = process.env): EnvLoadResult {
  const absPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absPath)) {
    return { filePath: absPath, loaded: [], exists: false };
  }

  const content = fs.readFileSync(absPath, "utf8");
  const parsed = parseDotEnv(content);
  const loaded: string[] = [];

  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] === undefined) {
      env[key] = value;
      loaded.push(key);
    }
  }

  return { filePath: absPath, loaded, exists: true };
}
