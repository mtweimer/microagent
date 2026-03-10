import type { AgentExecutionResult } from "../../../core/contracts.js";

export async function inspectSystemAction(): Promise<AgentExecutionResult> {
  return {
    status: "error",
    message: "Local system agent is scaffolded but not implemented yet."
  };
}
