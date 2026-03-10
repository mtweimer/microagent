import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { PersonaOverlayManager } from "../src/core/personaOverlayManager.js";
import { NarrativeMemory } from "../src/core/narrativeMemory.js";
import { StructuredTurnMemory } from "../src/core/memory.js";

const ROOT = "./data/persona/test-profile";
const NARR = "./data/test-narrative-overlay.jsonl";

test("persona overlay manager writes generated overlays", () => {
  if (fs.existsSync(ROOT)) fs.rmSync(ROOT, { recursive: true, force: true });
  if (fs.existsSync(NARR)) fs.unlinkSync(NARR);

  const manager = new PersonaOverlayManager("test-profile");
  const narrative = new NarrativeMemory(NARR);
  const memory = new StructuredTurnMemory();
  narrative.append({ text: "User asked for practical concise responses." });
  memory.addTurn({ role: "user", text: "Please keep responses practical and concise." });
  manager.refresh({ memory, narrativeMemory: narrative });

  const userContext = fs.readFileSync(`${ROOT}/user_context.generated.md`, "utf8");
  const style = fs.readFileSync(`${ROOT}/interaction_style.generated.md`, "utf8");
  assert.match(userContext, /practical/i);
  assert.match(style, /preferences/i);

  if (fs.existsSync(ROOT)) fs.rmSync(ROOT, { recursive: true, force: true });
  if (fs.existsSync(NARR)) fs.unlinkSync(NARR);
});

