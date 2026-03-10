import { executeAction } from "../base/executeAction.js";
import { searchFilesAction } from "./actions/searchFiles.js";
import manifest from "./manifest.json" with { type: "json" };
import type { ActionEnvelope, AgentExecutionContext, AgentExecutionResult } from "../../core/contracts.js";

type OneDriveActionHandler = (
  envelope: ActionEnvelope,
  context: AgentExecutionContext
) => Promise<AgentExecutionResult>;

export class OneDriveAgent {
  id: string;
  description: string;
  manifest: typeof manifest;

  constructor() {
    this.id = "ms.onedrive";
    this.description = "OneDrive actions (scaffold)";
    this.manifest = manifest;
  }

  async canHandle(envelope: ActionEnvelope | null | undefined): Promise<boolean> {
    return envelope?.agent === "ms.onedrive";
  }

  async execute(
    envelope: ActionEnvelope,
    context: AgentExecutionContext = {} as AgentExecutionContext
  ): Promise<AgentExecutionResult> {
    return executeAction({
      envelope,
      context,
      handlers: {
        search_files: searchFilesAction
      } as Record<string, OneDriveActionHandler>,
      fallbackErrorMessage: `Unsupported OneDrive action '${envelope.action}'`
    });
  }
}

export default function createAgent() {
  return new OneDriveAgent();
}
