import test from "node:test";
import assert from "node:assert/strict";

import { loadPersonaContext, composePersonaInstructions } from "../src/core/personaContext.js";

test("persona context loads base soul and agent markdown", () => {
  const context = loadPersonaContext("default");
  assert.match(context.soul, /soul\.md/i);
  assert.match(context.agent, /micro-claw/i);
});

test("persona instructions compose sections", () => {
  const text = composePersonaInstructions({
    soul: "Voice: calm",
    agent: "Agent baseline",
    tools: "",
    overlays: { userContext: "Prefers concise", interactionStyle: "" }
  });
  assert.match(text, /Agent baseline/);
  assert.match(text, /Voice: calm/);
  assert.match(text, /Prefers concise/);
});
