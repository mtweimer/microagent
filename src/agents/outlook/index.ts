import { executeAction } from "../base/executeAction.js";
import { sendEmailAction } from "./actions/sendEmail.js";
import { searchEmailAction } from "./actions/searchEmail.js";
import { listRecentEmailsAction } from "./actions/listRecentEmails.js";
import { readEmailAction } from "./actions/readEmail.js";
import manifest from "./manifest.json" with { type: "json" };
import type { ActionEnvelope, AgentExecutionContext, AgentExecutionResult, ExecutionStatus } from "../../core/contracts.js";

type OutlookActionHandler = (
  envelope: ActionEnvelope,
  context: AgentExecutionContext
) => Promise<AgentExecutionResult>;

function normalizeExecutionResult(value: unknown): AgentExecutionResult {
  const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const rawStatus = record.status;
  const status: ExecutionStatus =
    rawStatus === "ok" || rawStatus === "error" || rawStatus === "clarify" || rawStatus === "unsupported"
      ? rawStatus
      : "error";
  const message = typeof record.message === "string" ? record.message : "Action execution failed.";
  const artifacts =
    typeof record.artifacts === "object" && record.artifacts !== null
      ? (record.artifacts as Record<string, unknown>)
      : undefined;
  return artifacts ? { status, message, artifacts } : { status, message };
}

export class OutlookAgent {
  id: string;
  description: string;
  manifest: typeof manifest;

  constructor() {
    this.id = "ms.outlook";
    this.description = "Outlook mail actions";
    this.manifest = manifest;
  }

  async canHandle(envelope: ActionEnvelope | null | undefined): Promise<boolean> {
    return envelope?.agent === "ms.outlook";
  }

  async execute(
    envelope: ActionEnvelope,
    context: AgentExecutionContext = {} as AgentExecutionContext
  ): Promise<AgentExecutionResult> {
    const result = await executeAction({
      envelope,
      context,
      handlers: {
        send_email: sendEmailAction,
        search_email: searchEmailAction,
        list_recent_emails: listRecentEmailsAction,
        read_email: readEmailAction
      } as Record<string, OutlookActionHandler>,
      fallbackErrorMessage: `Unsupported Outlook action '${envelope.action}'`
    });
    return normalizeExecutionResult(result);
  }
}

export default function createAgent() {
  return new OutlookAgent();
}
