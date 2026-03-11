import { buildRuntime } from "../src/cli/runtime.js";

async function main() {
  const prompt = process.argv.slice(2).join(" ").trim();
  if (!prompt) {
    console.error('Usage: npm run retrieval:trace -- "<prompt>"');
    process.exitCode = 1;
    return;
  }

  const runtime = await buildRuntime("default");
  const route = runtime.dispatcher.explainRoute(prompt);
  const retrieval = await runtime.dispatcher.buildRetrievalResult({
    input: prompt,
    routeDecision: route,
    envelope: null,
    executionResult: null
  });

  const output = {
    prompt,
    route,
    plan: retrieval.plan,
    trace: retrieval.trace,
    selectedEvidence: retrieval.selectedEvidence.map((item) => ({
      id: item.id,
      sourceType: item.sourceType,
      title: item.title ?? null,
      snippet: item.snippet.slice(0, 160),
      score: item.score ?? null,
      timestamp: item.timestamp ?? null,
      provenance: item.provenance ?? null,
      breakdown: retrieval.trace.scoreBreakdownById[item.id] ?? null,
      selectionReason: retrieval.trace.selectionReasonById[item.id] ?? null
    })),
    overflowEvidence: retrieval.overflowEvidence.slice(0, 12).map((item) => ({
      id: item.id,
      sourceType: item.sourceType,
      title: item.title ?? null,
      snippet: item.snippet.slice(0, 160),
      score: item.score ?? null,
      selectionReason: retrieval.trace.selectionReasonById[item.id] ?? null
    }))
  };

  console.log(JSON.stringify(output, null, 2));
  clearInterval(runtime._teamsSyncTimer);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
