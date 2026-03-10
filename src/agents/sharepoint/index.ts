// @ts-nocheck
import { executeAction } from "../base/executeAction.js";
import { searchDocumentsAction } from "./actions/searchDocuments.js";
import manifest from "./manifest.json" with { type: "json" };

export class SharePointAgent {
  constructor() {
    this.id = "ms.sharepoint";
    this.description = "SharePoint actions (scaffold)";
    this.manifest = manifest;
  }

  async canHandle(envelope) {
    return envelope?.agent === "ms.sharepoint";
  }

  async execute(envelope, context = {}) {
    return executeAction({
      envelope,
      context,
      handlers: {
        search_documents: searchDocumentsAction
      },
      fallbackErrorMessage: `Unsupported SharePoint action '${envelope.action}'`
    });
  }
}

export default function createAgent() {
  return new SharePointAgent();
}
