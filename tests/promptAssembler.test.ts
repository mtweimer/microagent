// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";

import { assembleComposerMessages } from "../src/core/promptAssembler.js";

test("prompt assembler returns layered system+user messages", () => {
  const messages = assembleComposerMessages({
    input: "review inbox",
    actionEnvelope: { agent: "ms.outlook", action: "search_email", params: {} },
    executionResult: { status: "ok", message: "Found 2 email(s).", artifacts: {} },
    personaContext: { soul: "direct", agent: "helpful" },
    memoryEvidence: [{ id: 1, text: "client asked for update" }],
    narrativeEntries: [{ text: "recent summary" }]
  });

  assert.equal(Array.isArray(messages), true);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "system");
  assert.equal(messages[1].role, "user");
  assert.match(messages[0].content, /Output schema/);
});

