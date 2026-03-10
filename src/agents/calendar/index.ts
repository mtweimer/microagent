import { executeAction } from "../base/executeAction.js";
import { scheduleEventAction } from "./actions/scheduleEvent.js";
import { findEventsAction } from "./actions/findEvents.js";
import manifest from "./manifest.json" with { type: "json" };
import type { ActionEnvelope, AgentExecutionContext, AgentExecutionResult, ExecutionStatus } from "../../core/contracts.js";

type CalendarActionHandler = (
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

export class CalendarAgent {
  id: string;
  description: string;
  manifest: typeof manifest;

  constructor() {
    this.id = "ms.calendar";
    this.description = "Calendar actions";
    this.manifest = manifest;
  }

  async canHandle(envelope: ActionEnvelope | null | undefined): Promise<boolean> {
    return envelope?.agent === "ms.calendar";
  }

  async execute(
    envelope: ActionEnvelope,
    context: AgentExecutionContext = {} as AgentExecutionContext
  ): Promise<AgentExecutionResult> {
    const result = await executeAction({
      envelope,
      context,
      handlers: {
        schedule_event: scheduleEventAction,
        find_events: findEventsAction
      } as Record<string, CalendarActionHandler>,
      fallbackErrorMessage: `Unsupported Calendar action '${envelope.action}'`
    });
    return normalizeExecutionResult(result);
  }
}

export default function createAgent() {
  return new CalendarAgent();
}
