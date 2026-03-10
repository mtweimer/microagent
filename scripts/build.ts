import { spawnSync } from "node:child_process";

interface BuildStep {
  key: string;
  label: string;
  cmd: string;
  args: string[];
}

interface StepResult {
  key: string;
  label: string;
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface TestStats {
  pass: number;
  fail: number;
  skipped: number;
}

interface SchemaStats {
  total: number;
  ok: number;
}

interface CheckStats {
  profileOk: boolean;
  traceOk: boolean;
  schemaOk: boolean;
}

interface PromptStats {
  pass: number;
  fail: number;
  skipped: number;
  allowRisk: string;
}

const steps = [
  { key: "deps", label: "Dependencies", cmd: "npm", args: ["install"] },
  { key: "schema_generate", label: "Schema Generate", cmd: "npx", args: ["tsx", "scripts/generate-agent-schemas.ts"] },
  { key: "schema_check", label: "Schema Check", cmd: "npx", args: ["tsx", "scripts/schema-check.ts"] },
  { key: "plugins_validate", label: "Plugin Validate", cmd: "npx", args: ["tsx", "src/cli.ts", "plugins", "validate"] },
  { key: "tests", label: "Unit Tests", cmd: "npm", args: ["test"] },
  { key: "system_check", label: "System Check", cmd: "npx", args: ["tsx", "src/cli.ts", "check"] },
  {
    key: "prompt_safety",
    label: "Prompt Safety",
    cmd: "npx",
    args: ["tsx", "scripts/run-prompt-tests.ts", "--mode", "simulate", "--allow-risk", "low"]
  },
  { key: "doctor", label: "Service Health", cmd: "npx", args: ["tsx", "src/cli.ts", "doctor"] }
 ] satisfies BuildStep[];

const results: StepResult[] = [];
let failed = false;

for (const step of steps) {
  const run = spawnSync(step.cmd, step.args, {
    encoding: "utf8",
    shell: false
  });

  const stdout = String(run.stdout ?? "").trim();
  const stderr = String(run.stderr ?? "").trim();
  const ok = run.status === 0;
  results.push({
    key: step.key,
    label: step.label,
    ok,
    stdout,
    stderr,
    exitCode: run.status ?? 1
  });

  if (!ok) {
    failed = true;
    break;
  }
}

printSummary(results);

if (failed) {
  const firstFail = results.find((r) => !r.ok);
  console.error("");
  console.error(`Build failed at step: ${firstFail?.label}`);
  if (firstFail?.stderr) console.error(firstFail.stderr);
  else if (firstFail?.stdout) console.error(firstFail.stdout);
  process.exit(1);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function printSummary(items: StepResult[]): void {
  const byKey = Object.fromEntries(items.map((x) => [x.key, x]));
  const statusTag = (ok: boolean): "PASS" | "FAIL" => (ok ? "PASS" : "FAIL");

  console.log("Micro-Claw Build Summary");
  console.log("========================");
  for (const item of items) {
    console.log(`[${statusTag(item.ok)}] ${item.label}`);
  }

  const testStats = parseNodeTestStats(byKey.tests?.stdout ?? "");
  if (testStats) {
    console.log("");
    console.log(`Tests: ${testStats.pass} passed, ${testStats.fail} failed, ${testStats.skipped} skipped`);
  }

  const schemaStats = parseSchemaCheck(byKey.schema_check?.stdout ?? "");
  if (schemaStats) {
    console.log(`Schema: ${schemaStats.ok}/${schemaStats.total} domain checks passed`);
  }

  const checkStats = parseSystemCheck(byKey.system_check?.stdout ?? "");
  if (checkStats) {
    console.log(
      `System Check: profile=${checkStats.profileOk ? "ok" : "fail"}, ` +
        `trace=${checkStats.traceOk ? "ok" : "fail"}, schema=${checkStats.schemaOk ? "ok" : "fail"}`
    );
  }

  const promptStats = parsePromptSafety(byKey.prompt_safety?.stdout ?? "");
  if (promptStats) {
    console.log(
      `Prompt Safety: ${promptStats.pass} pass, ${promptStats.fail} fail, ${promptStats.skipped} skipped (risk=${promptStats.allowRisk})`
    );
  }

  const doctorStats = parseDoctor(byKey.doctor?.stdout ?? "");
  if (doctorStats) {
    console.log("Services:");
    for (const svc of doctorStats) console.log(`- ${svc}`);
  }
}

function parseJsonFromOutput(text: string): Record<string, unknown> | null {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return null;
  const idx = trimmed.indexOf("{");
  if (idx === -1) return null;
  const jsonText = trimmed.slice(idx);
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

function parseNodeTestStats(text: string): TestStats | null {
  const pass = pickInt(text, /ℹ pass (\d+)/);
  const fail = pickInt(text, /ℹ fail (\d+)/);
  const skipped = pickInt(text, /ℹ skipped (\d+)/);
  if (pass === null || fail === null || skipped === null) return null;
  return { pass, fail, skipped };
}

function parseSchemaCheck(text: string): SchemaStats | null {
  const data = parseJsonFromOutput(text);
  const checks = data ? asRecord(data).checks : null;
  if (!Array.isArray(checks)) return null;
  const total = checks.length;
  const ok = checks.filter((x) => asRecord(x).ok === true).length;
  return { total, ok };
}

function parseSystemCheck(text: string): CheckStats | null {
  const data = parseJsonFromOutput(text);
  if (!data) return null;
  const record = asRecord(data);
  return {
    profileOk: Boolean(asRecord(record.profileValidation).ok),
    traceOk: Boolean(asRecord(record.traceValidation).ok),
    schemaOk: Boolean(asRecord(record.schemaCheck).ok)
  };
}

function parsePromptSafety(text: string): PromptStats | null {
  const data = parseJsonFromOutput(text);
  const totals = data ? asRecord(asRecord(data).totals) : null;
  if (!totals) return null;
  return {
    pass: Number(totals.pass ?? 0),
    fail: Number(totals.fail ?? 0),
    skipped: Number(totals.skipped ?? 0),
    allowRisk: String(asRecord(data).allowRisk ?? "unknown")
  };
}

function parseDoctor(text: string): string[] | null {
  const data = parseJsonFromOutput(text);
  if (!data) return null;
  const record = asRecord(data);
  const rows: string[] = [];
  const providers = Array.isArray(record.providers) ? record.providers : [];
  for (const p of providers) {
    const provider = asRecord(p);
    const ok = provider.ok ? "ok" : "not-ready";
    rows.push(`provider:${String(provider.provider ?? "unknown")}=${ok}`);
  }
  const graph = asRecord(record.graph);
  if (graph.enabled) {
    rows.push(`graph=enabled tokenCached=${Boolean(graph.tokenCached)}`);
  } else {
    rows.push(`graph=disabled reason=${String(graph.reason ?? "unknown")}`);
  }
  const composer = asRecord(record.composer);
  const cache = asRecord(record.cache);
  const memory = asRecord(record.memory);
  const composerEnabled = composer.enabled !== false;
  rows.push(
    `composer=${composerEnabled ? "enabled" : "disabled"} ` +
      `strategy=${String(composer.strategy ?? "hybrid_fallback")} ` +
      `primaryReady=${Boolean(composer.primaryReady)} ` +
      `fallbackReady=${Boolean(composer.fallbackReady)}`
  );
  rows.push(
    `cache=enabled:${cache.enabled !== false} grammarSystem:${String(cache.grammarSystem ?? "completionBased")}`
  );
  rows.push(`memory=${String(memory.backend ?? "unknown")}`);
  return rows;
}

function pickInt(text: string, re: RegExp): number | null {
  const m = String(text).match(re);
  if (!m) return null;
  return Number(m[1]);
}
