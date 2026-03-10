import { executeAction } from "../base/executeAction.js";
import { inspectSystemAction } from "./actions/inspectSystem.js";
import manifest from "./manifest.json" with { type: "json" };
import type { ActionEnvelope, AgentExecutionContext, AgentExecutionResult } from "../../core/contracts.js";

type LocalSystemActionHandler = (
  envelope: ActionEnvelope,
  context: AgentExecutionContext
) => Promise<AgentExecutionResult>;

export class LocalSystemAgent {
  id: string;
  description: string;
  manifest: typeof manifest;

  constructor() {
    this.id = "local.system";
    this.description = "Local machine actions (scaffold)";
    this.manifest = manifest;
  }

  async canHandle(envelope: ActionEnvelope | null | undefined): Promise<boolean> {
    return envelope?.agent === "local.system";
  }

  async execute(
    envelope: ActionEnvelope,
    context: AgentExecutionContext = {} as AgentExecutionContext
  ): Promise<AgentExecutionResult> {
    return executeAction({
      envelope,
      context,
      handlers: {
        inspect_system: inspectSystemAction
      } as Record<string, LocalSystemActionHandler>,
      fallbackErrorMessage: `Unsupported local-system action '${envelope.action}'`
    });
  }
}

export default function createAgent() {
  return new LocalSystemAgent();
}
