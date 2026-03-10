// @ts-nocheck
import { executeAction } from "../base/executeAction.js";
import { searchFilesAction } from "./actions/searchFiles.js";
import manifest from "./manifest.json" with { type: "json" };

export class OneDriveAgent {
  constructor() {
    this.id = "ms.onedrive";
    this.description = "OneDrive actions (scaffold)";
    this.manifest = manifest;
  }

  async canHandle(envelope) {
    return envelope?.agent === "ms.onedrive";
  }

  async execute(envelope, context = {}) {
    return executeAction({
      envelope,
      context,
      handlers: {
        search_files: searchFilesAction
      },
      fallbackErrorMessage: `Unsupported OneDrive action '${envelope.action}'`
    });
  }
}

export default function createAgent() {
  return new OneDriveAgent();
}
