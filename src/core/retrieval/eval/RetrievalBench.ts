import type { RetrievalResult } from "../../contracts.js";
import type { RetrievalEngine } from "../engine/RetrievalEngine.js";

export interface RetrievalBenchCase {
  id: string;
  prompt: string;
  expectedSources?: string[];
  expectedEntities?: string[];
}

export class RetrievalBench {
  engine: RetrievalEngine;
  cases: RetrievalBenchCase[];

  constructor(engine: RetrievalEngine, cases: RetrievalBenchCase[]) {
    this.engine = engine;
    this.cases = cases;
  }

  async run(): Promise<Array<{ id: string; result: RetrievalResult }>> {
    const results: Array<{ id: string; result: RetrievalResult }> = [];
    for (const benchCase of this.cases) {
      results.push({
        id: benchCase.id,
        result: await this.engine.retrieve({ input: benchCase.prompt })
      });
    }
    return results;
  }
}
