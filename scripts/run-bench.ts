// @ts-nocheck
import { runBenchmarks } from "../src/bench/index.js";

const suiteArgIndex = process.argv.indexOf("--suite");
const suite = suiteArgIndex !== -1 ? process.argv[suiteArgIndex + 1] : "all";

const results = await runBenchmarks(suite);
console.log(JSON.stringify(results, null, 2));
