// @ts-nocheck
import fs from "node:fs";
import path from "node:path";

export class PersonaOverlayManager {
  constructor(profileName = "default") {
    this.root = path.resolve(process.cwd(), `data/persona/${profileName}`);
    this.userContextPath = path.join(this.root, "user_context.generated.md");
    this.interactionStylePath = path.join(this.root, "interaction_style.generated.md");
  }

  refresh({ memory, narrativeMemory }) {
    const recentNarrative = narrativeMemory?.summarize?.("week", 12) ?? [];
    const recentMemory = memory?.query?.("user preferences priorities style", { topK: 8 })?.results ?? [];

    const userContextLines = [];
    userContextLines.push("# user_context.generated.md");
    userContextLines.push("");
    userContextLines.push("Recent context:");
    for (const row of recentNarrative.slice(0, 8)) {
      userContextLines.push(`- ${truncate(row.text, 140)}`);
    }
    for (const row of recentMemory.slice(0, 6)) {
      if (row.role !== "user") continue;
      userContextLines.push(`- ${truncate(row.text, 140)}`);
    }

    const styleLines = [];
    styleLines.push("# interaction_style.generated.md");
    styleLines.push("");
    styleLines.push("Observed preferences:");
    styleLines.push("- prefers practical and direct responses");
    styleLines.push("- prefers clear capability boundaries");
    styleLines.push("- prefers reasoning grounded in available tools");

    this.writeFile(this.userContextPath, `${userContextLines.join("\n")}\n`);
    this.writeFile(this.interactionStylePath, `${styleLines.join("\n")}\n`);
  }

  writeFile(filePath, content) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content);
  }
}

function truncate(text, maxLen) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 3)}...`;
}
