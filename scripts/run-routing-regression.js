import { Dispatcher } from "../src/core/dispatcher.js";
import { StructuredTurnMemory } from "../src/core/memory.js";
import { InMemoryTranslationCache } from "../src/core/cache.js";
import { ModelGateway } from "../src/providers/modelGateway.js";
import { OutlookAgent } from "../src/agents/ms/outlookAgent.js";
import { CalendarAgent } from "../src/agents/ms/calendarAgent.js";
import { FileBackedPatternCache } from "../src/core/patternCache.js";
import { FileBackedGrammarStore } from "../src/core/grammarStore.js";
import { NarrativeMemory } from "../src/core/narrativeMemory.js";
import { loadPersonaContext } from "../src/core/personaContext.js";
import { PersonaOverlayManager } from "../src/core/personaOverlayManager.js";

const CASES = [
  {
    id: "chat_identity",
    input: "who are you and what's your purpose?",
    expect: { status: "ok", conversationMode: "chat" }
  },
  {
    id: "unsupported_weather",
    input: "what's the weather like in Indianapolis right now",
    expect: { status: "unsupported", capabilityGrounded: true }
  },
  {
    id: "calendar_today",
    input: "what's on my calendar for today",
    expect: { status: "ok", agent: "ms.calendar", action: "find_events" }
  },
  {
    id: "outlook_latest",
    input: "fetch my latest 2 emails",
    expect: { status: "ok", agent: "ms.outlook", action: "search_email", retrievalPlanDomain: "outlook" }
  },
  {
    id: "clarify_ambiguous",
    input: "set something up for me later",
    expect: { status: "clarify" }
  }
];

const MODES = ["completionBased", "nfa"];

const results = [];
for (const mode of MODES) {
  const run = await runMode(mode);
  results.push(run);
}

const totals = summarize(results);
const output = {
  timestamp: new Date().toISOString(),
  suite: "routing-regression",
  totals,
  runs: results
};

console.log(JSON.stringify(output, null, 2));
if (totals.fail > 0) process.exit(1);

async function runMode(mode) {
  const patternCache = new FileBackedPatternCache("./data/test-routing-pattern-cache.json");
  const grammarStore = new FileBackedGrammarStore("./data/test-routing-grammar-store.json");
  patternCache.clear();
  grammarStore.clear();

  const dispatcher = new Dispatcher({
    agents: [new OutlookAgent(), new CalendarAgent()],
    memory: new StructuredTurnMemory(),
    cache: new InMemoryTranslationCache(),
    modelGateway: new ModelGateway(process.env),
    graphClient: createMockGraphClient(),
    personaContext: loadPersonaContext("default"),
    narrativeMemory: new NarrativeMemory("./data/test-routing-narrative.jsonl"),
    patternCache,
    grammarStore,
    personaOverlayManager: new PersonaOverlayManager("default"),
    cacheConfig: {
      enabled: true,
      grammarSystem: mode
    },
    composerConfig: {
      enabled: false
    }
  });

  const rows = [];
  let pass = 0;
  let fail = 0;
  for (const item of CASES) {
    const out = await dispatcher.route(item.input);
    const ok = evaluate(out, item.expect);
    if (ok) pass += 1;
    else fail += 1;
    rows.push({
      id: item.id,
      input: item.input,
      ok,
      expected: item.expect,
      actual: {
        status: out.status,
        conversationMode: out.conversationMode ?? null,
        capabilityGrounded: out.capabilityGrounded ?? false,
        agent: out.artifacts?.action?.agent ?? null,
        action: out.artifacts?.action?.action ?? null,
        retrievalPlanDomain: out.retrievalPlan?.domain ?? null
      }
    });
  }

  return {
    mode,
    pass,
    fail,
    total: CASES.length,
    rows
  };
}

function evaluate(out, expected) {
  if (expected.status && out.status !== expected.status) return false;
  if (expected.conversationMode && out.conversationMode !== expected.conversationMode) return false;
  if (
    typeof expected.capabilityGrounded === "boolean" &&
    Boolean(out.capabilityGrounded) !== expected.capabilityGrounded
  ) {
    return false;
  }
  if (expected.agent && out.artifacts?.action?.agent !== expected.agent) return false;
  if (expected.action && out.artifacts?.action?.action !== expected.action) return false;
  if (expected.retrievalPlanDomain && out.retrievalPlan?.domain !== expected.retrievalPlanDomain) return false;
  return true;
}

function summarize(runs) {
  let pass = 0;
  let fail = 0;
  let total = 0;
  for (const run of runs) {
    pass += run.pass;
    fail += run.fail;
    total += run.total;
  }
  return { pass, fail, total };
}

function createMockGraphClient() {
  return {
    async get(path) {
      if (path.startsWith("/me/calendarView")) return { value: [] };
      if (path.startsWith("/me/messages")) return { value: [] };
      return {};
    },
    async post(path, body) {
      if (path === "/me/events") {
        return {
          id: "mock-event-id",
          subject: body?.subject ?? "Mock Event",
          start: body?.start,
          end: body?.end,
          webLink: "https://example.com/mock-event"
        };
      }
      if (path === "/me/sendMail") return { ok: true };
      return { ok: true };
    }
  };
}
