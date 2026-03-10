import { getActionConfig } from "../../contracts/actionRegistry.js";
import type { ActionEnvelope, AgentExecutionContext, AgentExecutionResult, ExecutionStatus } from "../../core/contracts.js";

type ActionHandler = (
  envelope: ActionEnvelope,
  context: AgentExecutionContext
) => Promise<AgentExecutionResult>;

interface ExecuteActionInput {
  envelope: ActionEnvelope;
  context: AgentExecutionContext;
  handlers: Record<string, ActionHandler>;
  fallbackErrorMessage?: string;
}

function normalizeStatus(value: unknown): ExecutionStatus {
  return value === "ok" || value === "error" || value === "clarify" || value === "unsupported" ? value : "error";
}

export async function executeAction({
  envelope,
  context,
  handlers,
  fallbackErrorMessage
}: ExecuteActionInput): Promise<AgentExecutionResult> {
  const actionCfg = getActionConfig(envelope.agent, envelope.action);
  if (!actionCfg) {
    return {
      status: "error",
      message: `Unknown action '${envelope.agent}.${envelope.action}'`
    };
  }

  const handler = handlers[envelope.action];
  if (!handler) {
    return {
      status: "error",
      message: fallbackErrorMessage ?? `Unsupported action '${envelope.action}'`
    };
  }

  const graph = context?.graphClient;
  if (!graph && envelope.agent.startsWith("ms.")) {
    return {
      status: "error",
      message: "Graph client is not configured. Set MSGRAPH_APP_CLIENTID and run '/graph login'."
    };
  }

  try {
    const result = await handler(envelope, context);
    const artifacts =
      typeof result?.artifacts === "object" && result.artifacts !== null
        ? (result.artifacts as Record<string, unknown>)
        : {};
    return {
      status: normalizeStatus(result?.status),
      message: result?.message ?? "Action completed.",
      artifacts
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Action execution failed"
    };
  }
}
