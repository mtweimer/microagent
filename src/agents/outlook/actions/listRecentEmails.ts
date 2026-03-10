import type { ActionEnvelope, AgentExecutionContext, AgentExecutionResult, AnyRecord } from "../../../core/contracts.js";

interface GraphMessage {
  id?: string;
  subject?: string;
  from?: {
    emailAddress?: {
      address?: string;
    };
  };
  receivedDateTime?: string;
  bodyPreview?: string;
}

function asRecord(value: unknown): AnyRecord {
  return typeof value === "object" && value !== null ? (value as AnyRecord) : {};
}

function asMessageList(value: unknown): GraphMessage[] {
  const record = asRecord(value);
  return Array.isArray(record.value) ? (record.value as GraphMessage[]) : [];
}

export async function listRecentEmailsAction(
  env: ActionEnvelope,
  ctx: AgentExecutionContext
): Promise<AgentExecutionResult> {
  const graph = ctx.graphClient;
  if (!graph?.get) {
    return { status: "error", message: "Graph client is not configured." };
  }
  const limit = clampLimit(env.params?.limit);
  const path =
    "/me/messages" +
    `?$top=${limit}` +
    "&$orderby=receivedDateTime desc" +
    "&$select=id,subject,from,receivedDateTime,bodyPreview";
  const data = await graph.get(path);
  const messages = asMessageList(data).map((m) => ({
    id: m.id,
    subject: m.subject,
    from: m.from?.emailAddress?.address,
    receivedDateTime: m.receivedDateTime,
    bodyPreview: m.bodyPreview ?? ""
  }));
  return {
    status: "ok",
    message: `Retrieved ${messages.length} recent email(s).`,
    artifacts: {
      limit,
      messages
    }
  };
}

function clampLimit(value: unknown): number {
  const n = Number(value);
  if (Number.isNaN(n) || n < 1) return 5;
  return Math.min(50, Math.floor(n));
}
