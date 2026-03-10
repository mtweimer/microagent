import { getActionConfig } from "../../contracts/actionRegistry.js";

export async function executeAction({ envelope, context, handlers, fallbackErrorMessage }) {
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
    return {
      status: result?.status ?? "ok",
      message: result?.message ?? "Action completed.",
      artifacts: result?.artifacts ?? {}
    };
  } catch (error) {
    return {
      status: "error",
      message: error?.message ?? "Action execution failed"
    };
  }
}
