import type { ActionEnvelope, AgentExecutionContext, AgentExecutionResult, AnyRecord } from "../../../core/contracts.js";

interface GraphMessageBody {
  content?: string;
}

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
  body?: GraphMessageBody;
}

function asRecord(value: unknown): AnyRecord {
  return typeof value === "object" && value !== null ? (value as AnyRecord) : {};
}

function asGraphMessage(value: unknown): GraphMessage {
  return asRecord(value) as GraphMessage;
}

function asMessageList(value: unknown): GraphMessage[] {
  const record = asRecord(value);
  return Array.isArray(record.value) ? (record.value as GraphMessage[]) : [];
}

export async function readEmailAction(
  env: ActionEnvelope,
  ctx: AgentExecutionContext
): Promise<AgentExecutionResult> {
  const graph = ctx.graphClient;
  if (!graph?.get) {
    return { status: "error", message: "Graph client is not configured." };
  }
  let id = String(env.params?.id ?? "").trim();
  const reference = String(env.params?.reference ?? "").trim().toLowerCase();
  if (!id && reference) {
    id = await resolveReferenceId(graph, reference);
  }
  if (!id) {
    return {
      status: "error",
      message: "No email id was provided. Ask for latest email first or specify an email id."
    };
  }

  const path =
    `/me/messages/${encodeURIComponent(id)}` +
    "?$select=id,subject,from,receivedDateTime,bodyPreview,body";
  const message = asGraphMessage(await graph.get(path));
  return {
    status: "ok",
    message: `Read email: ${message.subject || "(no subject)"}`,
    artifacts: {
      id: message.id,
      subject: message.subject,
      from: message.from?.emailAddress?.address,
      receivedDateTime: message.receivedDateTime,
      bodyPreview: message.bodyPreview ?? "",
      body: message.body?.content ?? ""
    }
  };
}

async function resolveReferenceId(
  graph: NonNullable<AgentExecutionContext["graphClient"]>,
  reference: string
): Promise<string> {
  if (!graph.get) return "";
  const data = await graph.get(
    "/me/messages?$top=2&$orderby=receivedDateTime desc&$select=id,subject,from,receivedDateTime,bodyPreview"
  );
  const messages = asMessageList(data);
  if (reference === "previous") return messages[1]?.id ?? "";
  return messages[0]?.id ?? "";
}
