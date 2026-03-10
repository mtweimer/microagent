import { runPromptSuite } from "../src/bench/promptSuite.js";

function argValue(name: string, fallback?: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

const suite = argValue("suite", "benchmarks/prompt-suites/smoke.json") ?? "benchmarks/prompt-suites/smoke.json";
const profile = argValue("profile", "default") ?? "default";
const mode = (argValue("mode", "simulate") ?? "simulate") as "simulate" | "live";
const allowRisk = argValue("allow-risk", "low") ?? "low";
const provider = argValue("provider");
const model = argValue("model");
const graphLive = process.argv.includes("--graph-live");

const output = await runPromptSuite({
  suitePath: suite,
  profileName: profile,
  mode,
  allowRisk,
  ...(provider ? { provider } : {}),
  ...(model ? { model } : {}),
  graphLive
});

console.log(JSON.stringify(output, null, 2));
