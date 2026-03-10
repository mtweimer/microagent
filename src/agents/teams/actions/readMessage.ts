import type { ActionEnvelope, AgentExecutionContext, AgentExecutionResult } from "../../../core/contracts.js";

export async function readMessageAction(
  env: ActionEnvelope,
  ctx: AgentExecutionContext
): Promise<AgentExecutionResult> {
  const teamsIndex = ctx.teamsIndex;
  const id = String(env.params?.id ?? "").trim();
  if (!id) {
    return {
      status: "error",
      message: "No Teams message id was provided."
    };
  }
  if (!teamsIndex || typeof teamsIndex.getMessageById !== "function") {
    return {
      status: "error",
      message: "Teams local index is unavailable for read_message."
    };
  }
  const row = teamsIndex.getMessageById(id);
  if (!row) {
    return {
      status: "error",
      message: `Teams message '${id}' was not found in the local index.`
    };
  }
  return {
    status: "ok",
    message: "Read Teams message.",
    artifacts: {
      ...row
    }
  };
}
