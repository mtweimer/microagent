import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Dispatcher } from "../core/dispatcher.js";
import { StructuredTurnMemory } from "../core/memory.js";
import { InMemoryTranslationCache } from "../core/cache.js";
import { loadEnvFile } from "../core/env.js";
import { applyProfileToEnv, loadProfile } from "../core/profile.js";
import { ModelGateway } from "../providers/modelGateway.js";
import { OutlookAgent } from "../agents/ms/outlookAgent.js";
import { CalendarAgent } from "../agents/ms/calendarAgent.js";
import { createGraphClient } from "../graph/factory.js";
import { inferActionRisk, normalizeRisk, shouldExecuteCase } from "./riskPolicy.js";
import type { AnyRecord, DispatcherResponse, GraphClientLike } from "../core/contracts.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "../..");

interface PromptExpectation {
  status?: string;
  agent?: string;
  action?: string;
  messageIncludes?: string;
}

interface PromptCase {
  id: string;
  input: string;
  risk?: string;
  expect?: PromptExpectation;
}

interface PromptSuiteFile {
  name?: string;
  cases?: PromptCase[];
}

function loadSuite(filePath: string): PromptSuiteFile {
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
  return JSON.parse(fs.readFileSync(resolved, "utf8")) as PromptSuiteFile;
}

function asRecord(value: unknown): AnyRecord {
  return typeof value === "object" && value !== null ? (value as AnyRecord) : {};
}

export async function runPromptSuite({
  suitePath,
  profileName = "default",
  mode = "simulate",
  allowRisk = "low",
  provider,
  model,
  graphLive = false
}: {
  suitePath: string;
  profileName?: string;
  mode?: "simulate" | "live";
  allowRisk?: string;
  provider?: string;
  model?: string;
  graphLive?: boolean;
}) {
  const normalizedAllowRisk = normalizeRisk(allowRisk, "low");
  const envInfo = loadEnvFile(".env");
  const { profile } = loadProfile(profileName);
  applyProfileToEnv(profile, process.env);

  const modelGateway = new ModelGateway(process.env);
  if (provider) modelGateway.setActiveProvider(provider);
  if (model) modelGateway.setActiveModel(model, modelGateway.getActiveProvider());

  const graphState = createGraphClient(profile, process.env);
  const dryDispatcher = new Dispatcher({
    agents: [new OutlookAgent(), new CalendarAgent()],
    memory: new StructuredTurnMemory(),
    cache: new InMemoryTranslationCache(),
    modelGateway,
    graphClient: createMockGraphClient()
  });
  const liveDispatcher = new Dispatcher({
    agents: [new OutlookAgent(), new CalendarAgent()],
    memory: new StructuredTurnMemory(),
    cache: new InMemoryTranslationCache(),
    modelGateway,
    graphClient: resolveGraphClient({ mode, graphLive, graphState })
  });

  const suite = loadSuite(suitePath);
  const rows = [];
  let pass = 0;
  let fail = 0;
  let skipped = 0;

  for (const item of suite.cases ?? []) {
    const declaredRisk = normalizeRisk(item.risk ?? "medium");
    if (!shouldExecuteCase(declaredRisk, normalizedAllowRisk)) {
      skipped += 1;
      rows.push({
        id: item.id,
        input: item.input,
        status: "skipped",
        reason: `blocked_by_risk_policy (${declaredRisk} > ${normalizedAllowRisk})`,
        declaredRisk
      });
      continue;
    }

    const dryOut = await dryDispatcher.route(item.input);
    const effectiveRisk = inferActionRisk(dryOut.artifacts?.action);
    if (!shouldExecuteCase(effectiveRisk, normalizedAllowRisk)) {
      skipped += 1;
      rows.push({
        id: item.id,
        input: item.input,
        status: "skipped",
        reason: `blocked_by_inferred_risk (${effectiveRisk} > ${normalizedAllowRisk})`,
        declaredRisk,
        effectiveRisk,
        actual: summarizeOutput(dryOut)
      });
      continue;
    }

    const out = mode === "simulate" ? dryOut : await liveDispatcher.route(item.input);
    const ok = evaluateExpectation(out, item.expect ?? {});
    if (ok) pass += 1;
    else fail += 1;

    rows.push({
      id: item.id,
      input: item.input,
      ok,
      status: out.status,
      message: out.message,
      declaredRisk,
      effectiveRisk,
      expected: item.expect ?? {},
      actual: summarizeOutput(out)
    });
  }

  return {
    timestamp: new Date().toISOString(),
    suite: suite.name ?? path.basename(suitePath),
    mode,
    allowRisk: normalizedAllowRisk,
    envLoadedKeys: envInfo.loaded.length,
    provider: modelGateway.getActiveProvider(),
    model: modelGateway.getActiveModel(),
    totals: {
      pass,
      fail,
      skipped,
      total: pass + fail + skipped
    },
    rows
  };
}

function evaluateExpectation(out: DispatcherResponse, expected: PromptExpectation) {
  const action = asRecord(asRecord(out.artifacts).action);
  if (expected.status && out.status !== expected.status) return false;
  if (expected.agent && action.agent !== expected.agent) return false;
  if (expected.action && action.action !== expected.action) return false;
  if (expected.messageIncludes && !String(out.message ?? "").toLowerCase().includes(String(expected.messageIncludes).toLowerCase())) {
    return false;
  }
  return true;
}

function summarizeOutput(out: DispatcherResponse) {
  const action = asRecord(asRecord(out.artifacts).action);
  return {
    status: out.status,
    agent: action.agent ?? null,
    action: action.action ?? null,
    message: out.message
  };
}

function resolveGraphClient({
  mode,
  graphLive,
  graphState
}: {
  mode: "simulate" | "live";
  graphLive: boolean;
  graphState: { enabled: boolean; reason?: string; client?: GraphClientLike };
}): GraphClientLike {
  if (mode === "simulate" || !graphLive) return createMockGraphClient();
  if (!graphState.enabled) {
    throw new Error(`Graph is disabled: ${graphState.reason}`);
  }
  return graphState.client as GraphClientLike;
}

function createMockGraphClient() {
  return {
    async get(path: string) {
      if (path.startsWith("/me/calendarView")) return { value: [] };
      if (path.startsWith("/me/messages")) return { value: [] };
      if (path === "/me") {
        return {
          displayName: "Mock User",
          userPrincipalName: "mock@example.com",
          mail: "mock@example.com",
          id: "mock-id"
        };
      }
      return {};
    },
    async post(path: string, body: AnyRecord | undefined) {
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
    },
    async patch() {
      return { ok: true };
    }
  };
}
