import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Dispatcher } from "../core/dispatcher.js";
import { StructuredTurnMemory } from "../core/memory.js";
import { InMemoryTranslationCache } from "../core/cache.js";
import { OutlookAgent } from "../agents/ms/outlookAgent.js";
import { CalendarAgent } from "../agents/ms/calendarAgent.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "../..");

function loadJson(file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
}

export async function runBenchmarks(suite = "all") {
  const benches = [];
  if (suite === "all" || suite === "reasoning") benches.push(await runReasoningBench());
  if (suite === "all" || suite === "memory") benches.push(await runMemoryBench());
  if (suite === "all" || suite === "cache") benches.push(await runCacheBench());

  return {
    timestamp: new Date().toISOString(),
    benchmarks: benches
  };
}

async function runReasoningBench() {
  const cases = loadJson("benchmarks/scenarios/reasoning.json");
  const dispatcher = new Dispatcher({
    agents: [new OutlookAgent(), new CalendarAgent()],
    memory: new StructuredTurnMemory(),
    cache: new InMemoryTranslationCache()
  });

  let pass = 0;
  const rows = [];
  for (const c of cases) {
    const out = await dispatcher.route(c.input);
    const translatedAgent =
      out.artifacts?.action?.agent ?? out.artifacts?.typed?.agent ?? null;
    const got = translatedAgent?.startsWith("ms.")
      ? translatedAgent.replace("ms.", "")
      : translatedAgent;
    const ok = got === c.expectedDomain;
    if (ok) pass += 1;
    rows.push({ id: c.id, ok, expected: c.expectedDomain, got });
  }

  return {
    suite: "reasoning",
    pass,
    total: cases.length,
    score: cases.length === 0 ? 0 : pass / cases.length,
    rows
  };
}

async function runMemoryBench() {
  const cases = loadJson("benchmarks/scenarios/memory.json");
  const memory = new StructuredTurnMemory();
  let pass = 0;
  const rows = [];

  for (const c of cases) {
    for (const turn of c.turns) memory.addTurn({ role: "user", text: turn });
    const result = memory.query(c.query, { topK: 5 });
    const joined = result.results.map((r) => r.text.toLowerCase()).join(" ");
    const ok = c.mustContain.every((term) => joined.includes(term));
    if (ok) pass += 1;
    rows.push({ id: c.id, ok, results: result.results.length });
  }

  return {
    suite: "memory",
    pass,
    total: cases.length,
    score: cases.length === 0 ? 0 : pass / cases.length,
    rows
  };
}

async function runCacheBench() {
  const dispatcher = new Dispatcher({
    agents: [new OutlookAgent(), new CalendarAgent()],
    memory: new StructuredTurnMemory(),
    cache: new InMemoryTranslationCache()
  });

  const request = "schedule a meeting tomorrow at 3";
  const first = await dispatcher.route(request);
  const second = await dispatcher.route(request);

  return {
    suite: "cache",
    pass: second.trace?.cacheHit ? 1 : 0,
    total: 1,
    score: second.trace?.cacheHit ? 1 : 0,
    rows: [
      {
        request,
        firstStatus: first.status,
        secondCacheHit: !!second.trace?.cacheHit
      }
    ]
  };
}
