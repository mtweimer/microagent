import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Dispatcher } from "../core/dispatcher.js";
import { StructuredTurnMemory } from "../core/memory.js";
import { InMemoryTranslationCache } from "../core/cache.js";
import { OutlookAgent } from "../agents/ms/outlookAgent.js";
import { CalendarAgent } from "../agents/ms/calendarAgent.js";
import type { AnyRecord, DispatcherResponse } from "../core/contracts.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "../..");

interface ReasoningCase {
  id: string;
  input: string;
  expectedDomain: string;
}

interface MemoryCase {
  id: string;
  turns: string[];
  query: string;
  mustContain: string[];
}

interface BenchSuite<T> {
  cases: T[];
}

function asRecord(value: unknown): AnyRecord {
  return typeof value === "object" && value !== null ? (value as AnyRecord) : {};
}

function loadJson<T>(file: string): BenchSuite<T> {
  return JSON.parse(fs.readFileSync(path.join(root, file), "utf8")) as BenchSuite<T>;
}

export async function runBenchmarks(suite = "all"): Promise<{ timestamp: string; benchmarks: unknown[] }> {
  const benches: unknown[] = [];
  if (suite === "all" || suite === "reasoning") benches.push(await runReasoningBench());
  if (suite === "all" || suite === "memory") benches.push(await runMemoryBench());
  if (suite === "all" || suite === "cache") benches.push(await runCacheBench());

  return {
    timestamp: new Date().toISOString(),
    benchmarks: benches
  };
}

async function runReasoningBench() {
  const cases = loadJson<ReasoningCase>("benchmarks/scenarios/reasoning.json");
  const dispatcher = new Dispatcher({
    agents: [new OutlookAgent(), new CalendarAgent()],
    memory: new StructuredTurnMemory(),
    cache: new InMemoryTranslationCache(),
    modelGateway: null,
    graphClient: null
  });

  let pass = 0;
  const rows = [];
  for (const c of cases.cases) {
    const out = await dispatcher.route(c.input);
    const artifacts = asRecord((out as DispatcherResponse).artifacts);
    const action = asRecord(artifacts.action);
    const typed = asRecord(artifacts.typed);
    const translatedAgent =
      (typeof action.agent === "string" ? action.agent : null) ??
      (typeof typed.agent === "string" ? typed.agent : null);
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
    total: cases.cases.length,
    score: cases.cases.length === 0 ? 0 : pass / cases.cases.length,
    rows
  };
}

async function runMemoryBench() {
  const cases = loadJson<MemoryCase>("benchmarks/scenarios/memory.json");
  const memory = new StructuredTurnMemory();
  let pass = 0;
  const rows = [];

  for (const c of cases.cases) {
    for (const turn of c.turns) memory.addTurn({ role: "user", text: turn, source: "bench" });
    const result = memory.query(c.query, { topK: 5 });
    const joined = result.results.map((r) => String(r.text ?? "").toLowerCase()).join(" ");
    const ok = c.mustContain.every((term) => joined.includes(term));
    if (ok) pass += 1;
    rows.push({ id: c.id, ok, results: result.results.length });
  }

  return {
    suite: "memory",
    pass,
    total: cases.cases.length,
    score: cases.cases.length === 0 ? 0 : pass / cases.cases.length,
    rows
  };
}

async function runCacheBench() {
  const dispatcher = new Dispatcher({
    agents: [new OutlookAgent(), new CalendarAgent()],
    memory: new StructuredTurnMemory(),
    cache: new InMemoryTranslationCache(),
    modelGateway: null,
    graphClient: null
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
