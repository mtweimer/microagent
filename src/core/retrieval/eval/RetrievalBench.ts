import type { RetrievalResult } from "../../contracts.js";
import type { RetrievalEngine } from "../engine/RetrievalEngine.js";
import type { RetrievalBenchCase } from "./benchmarkCases.js";

export interface RetrievalBenchCaseResult {
  id: string;
  result: RetrievalResult;
  checks: {
    intent: boolean;
    entities: boolean;
    sources: boolean;
    topSource: boolean;
    topTitle: boolean;
  };
  passed: boolean;
}

function includesAll(actual: string[], expected: string[] = []): boolean {
  const set = new Set(actual.map((value) => value.toLowerCase()));
  return expected.every((value) => set.has(value.toLowerCase()));
}

function topTitleMatches(result: RetrievalResult, expected: string[] = []): boolean {
  if (expected.length === 0) return true;
  const title = String(result.selectedEvidence[0]?.title ?? result.selectedEvidence[0]?.snippet ?? "").toLowerCase();
  return expected.some((value) => title.includes(value.toLowerCase()));
}

export class RetrievalBench {
  engine: RetrievalEngine;
  cases: RetrievalBenchCase[];

  constructor(engine: RetrievalEngine, cases: RetrievalBenchCase[]) {
    this.engine = engine;
    this.cases = cases;
  }

  async run(): Promise<RetrievalBenchCaseResult[]> {
    const results: RetrievalBenchCaseResult[] = [];
    for (const benchCase of this.cases) {
      const result = await this.engine.retrieve({ input: benchCase.prompt });
      const checks = {
        intent: !benchCase.expectedIntent || result.plan.intent === benchCase.expectedIntent,
        entities: includesAll(result.plan.entities, benchCase.expectedEntities),
        sources: includesAll(result.plan.sources, benchCase.expectedSources),
        topSource: !benchCase.expectedTopSource || result.selectedEvidence[0]?.sourceType === benchCase.expectedTopSource,
        topTitle: topTitleMatches(result, benchCase.expectedTopTitleIncludes)
      };
      results.push({
        id: benchCase.id,
        result,
        checks,
        passed: Object.values(checks).every(Boolean)
      });
    }
    return results;
  }
}
