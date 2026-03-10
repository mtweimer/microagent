import { runPromptSuite } from "../src/bench/promptSuite.js";

function argValue(name, fallback = undefined) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

const suite = argValue("suite", "benchmarks/prompt-suites/smoke.json");
const profile = argValue("profile", "default");
const mode = argValue("mode", "simulate");
const allowRisk = argValue("allow-risk", "low");
const provider = argValue("provider");
const model = argValue("model");
const graphLive = process.argv.includes("--graph-live");

const output = await runPromptSuite({
  suitePath: suite,
  profileName: profile,
  mode,
  allowRisk,
  provider,
  model,
  graphLive
});

console.log(JSON.stringify(output, null, 2));
