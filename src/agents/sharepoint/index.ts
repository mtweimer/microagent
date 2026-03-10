import { executeAction } from "../base/executeAction.js";
import { searchDocumentsAction } from "./actions/searchDocuments.js";
import manifest from "./manifest.json" with { type: "json" };
import type { ActionEnvelope, AgentExecutionContext, AgentExecutionResult } from "../../core/contracts.js";

type SharePointActionHandler = (
  envelope: ActionEnvelope,
  context: AgentExecutionContext
) => Promise<AgentExecutionResult>;

export class SharePointAgent {
  id: string;
  description: string;
  manifest: typeof manifest;

  constructor() {
    this.id = "ms.sharepoint";
    this.description = "SharePoint actions (scaffold)";
    this.manifest = manifest;
  }

  async canHandle(envelope: ActionEnvelope | null | undefined): Promise<boolean> {
    return envelope?.agent === "ms.sharepoint";
  }

  async execute(
    envelope: ActionEnvelope,
    context: AgentExecutionContext = {} as AgentExecutionContext
  ): Promise<AgentExecutionResult> {
    return executeAction({
      envelope,
      context,
      handlers: {
        search_documents: searchDocumentsAction
      } as Record<string, SharePointActionHandler>,
      fallbackErrorMessage: `Unsupported SharePoint action '${envelope.action}'`
    });
  }
}

export default function createAgent() {
  return new SharePointAgent();
}
