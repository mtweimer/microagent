// @ts-nocheck
import { spawnSync } from "node:child_process";

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
    cmd: "node",
    args: ["tsx", "scripts/run-prompt-tests.ts", "--mode", "simulate", "--allow-risk", "low"]
  },
  { key: "doctor", label: "Service Health", cmd: "npx", args: ["tsx", "src/cli.ts", "doctor"] }
];

const results = [];
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

function printSummary(items) {
  const byKey = Object.fromEntries(items.map((x) => [x.key, x]));
  const statusTag = (ok) => (ok ? "PASS" : "FAIL");

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

function parseJsonFromOutput(text) {
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

function parseNodeTestStats(text) {
  const pass = pickInt(text, /ℹ pass (\d+)/);
  const fail = pickInt(text, /ℹ fail (\d+)/);
  const skipped = pickInt(text, /ℹ skipped (\d+)/);
  if (pass === null || fail === null || skipped === null) return null;
  return { pass, fail, skipped };
}

function parseSchemaCheck(text) {
  const data = parseJsonFromOutput(text);
  if (!data?.checks || !Array.isArray(data.checks)) return null;
  const total = data.checks.length;
  const ok = data.checks.filter((x) => x.ok).length;
  return { total, ok };
}

function parseSystemCheck(text) {
  const data = parseJsonFromOutput(text);
  if (!data) return null;
  return {
    profileOk: !!data.profileValidation?.ok,
    traceOk: !!data.traceValidation?.ok,
    schemaOk: !!data.schemaCheck?.ok
  };
}

function parsePromptSafety(text) {
  const data = parseJsonFromOutput(text);
  if (!data?.totals) return null;
  return {
    pass: Number(data.totals.pass ?? 0),
    fail: Number(data.totals.fail ?? 0),
    skipped: Number(data.totals.skipped ?? 0),
    allowRisk: data.allowRisk ?? "unknown"
  };
}

function parseDoctor(text) {
  const data = parseJsonFromOutput(text);
  if (!data) return null;
  const rows = [];
  for (const p of data.providers ?? []) {
    const ok = p.ok ? "ok" : "not-ready";
    rows.push(`provider:${p.provider}=${ok}`);
  }
  if (data.graph?.enabled) {
    rows.push(`graph=enabled tokenCached=${Boolean(data.graph.tokenCached)}`);
  } else {
    rows.push(`graph=disabled reason=${data.graph?.reason ?? "unknown"}`);
  }
  const composerEnabled = data.composer?.enabled !== false;
  rows.push(
    `composer=${composerEnabled ? "enabled" : "disabled"} ` +
      `strategy=${data.composer?.strategy ?? "hybrid_fallback"} ` +
      `primaryReady=${Boolean(data.composer?.primaryReady)} ` +
      `fallbackReady=${Boolean(data.composer?.fallbackReady)}`
  );
  rows.push(
    `cache=enabled:${data.cache?.enabled !== false} grammarSystem:${data.cache?.grammarSystem ?? "completionBased"}`
  );
  rows.push(`memory=${data.memory?.backend ?? "unknown"}`);
  return rows;
}

function pickInt(text, re) {
  const m = String(text).match(re);
  if (!m) return null;
  return Number(m[1]);
}
