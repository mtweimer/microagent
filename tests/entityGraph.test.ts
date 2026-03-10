import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { EntityGraph } from "../src/core/entityGraph.js";
import { makeEnvelope } from "./helpers.js";

const FILE = "/tmp/micro-claw-entity-graph.test.sqlite";

test("entity graph stores and looks up observed entities", () => {
  try {
    fs.unlinkSync(FILE);
  } catch {}
  const graph = new EntityGraph(FILE);
  graph.initialize();
  graph.observeExecution(
    makeEnvelope({ agent: "ms.outlook", action: "search_email", params: {} }),
    {
      messages: [
        {
          id: "m1",
          subject: "Valeo Design Review",
          from: "michael@hopliteconsulting.com"
        }
      ]
    }
  );

  const lookup = graph.lookup("Valeo");
  assert.equal(lookup.entities.length, 1);
  assert.match(String(lookup.entities[0]?.name), /Valeo/);
  assert.equal((lookup.entities[0]?.mentions.length ?? 0) >= 1, true);
});

test("entity graph recent returns observed entities", () => {
  const graph = new EntityGraph(FILE);
  graph.initialize();
  const rows = graph.recent(5);
  assert.equal(rows.length >= 1, true);
});
