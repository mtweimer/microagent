import { executeAction } from "../base/executeAction.js";
import { searchMessagesAction } from "./actions/searchMessages.js";
import { reviewMyDayAction } from "./actions/reviewMyDay.js";
import { searchMentionsAction } from "./actions/searchMentions.js";
import { readMessageAction } from "./actions/readMessage.js";
import manifest from "./manifest.json" with { type: "json" };
import type { ActionEnvelope, AgentExecutionContext, AgentExecutionResult, ExecutionStatus } from "../../core/contracts.js";

type TeamsActionHandler = (
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

export class TeamsAgent {
  id: string;
  description: string;
  manifest: typeof manifest;

  constructor() {
    this.id = "ms.teams";
    this.description = "Teams actions (scaffold)";
    this.manifest = manifest;
  }

  async canHandle(envelope: ActionEnvelope | null | undefined): Promise<boolean> {
    return envelope?.agent === "ms.teams";
  }

  async execute(
    envelope: ActionEnvelope,
    context: AgentExecutionContext = {} as AgentExecutionContext
  ): Promise<AgentExecutionResult> {
    const result = await executeAction({
      envelope,
      context,
      handlers: {
        review_my_day: reviewMyDayAction,
        search_mentions: searchMentionsAction,
        search_messages: searchMessagesAction,
        read_message: readMessageAction
      } as Record<string, TeamsActionHandler>,
      fallbackErrorMessage: `Unsupported Teams action '${envelope.action}'`
    });
    return normalizeExecutionResult(result);
  }
}

export default function createAgent() {
  return new TeamsAgent();
}
