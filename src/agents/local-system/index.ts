// @ts-nocheck
import { executeAction } from "../base/executeAction.js";
import { inspectSystemAction } from "./actions/inspectSystem.js";
import manifest from "./manifest.json" with { type: "json" };

export class LocalSystemAgent {
  constructor() {
    this.id = "local.system";
    this.description = "Local machine actions (scaffold)";
    this.manifest = manifest;
  }

  async canHandle(envelope) {
    return envelope?.agent === "local.system";
  }

  async execute(envelope, context = {}) {
    return executeAction({
      envelope,
      context,
      handlers: {
        inspect_system: inspectSystemAction
      },
      fallbackErrorMessage: `Unsupported local-system action '${envelope.action}'`
    });
  }
}

export default function createAgent() {
  return new LocalSystemAgent();
}
