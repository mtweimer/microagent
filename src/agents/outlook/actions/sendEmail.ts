import type { ActionEnvelope, AgentExecutionContext, AgentExecutionResult } from "../../../core/contracts.js";

interface GraphRecipient {
  emailAddress: {
    address: string;
  };
}

interface SendMailMessage {
  subject: string;
  body: {
    contentType: "Text";
    content: string;
  };
  toRecipients: GraphRecipient[];
}

export async function sendEmailAction(
  env: ActionEnvelope,
  ctx: AgentExecutionContext
): Promise<AgentExecutionResult> {
  const graph = ctx.graphClient;
  if (!graph?.post) {
    return { status: "error", message: "Graph client is not configured." };
  }
  const to = Array.isArray(env.params?.to)
    ? env.params.to.filter((addr): addr is string => typeof addr === "string" && addr.trim().length > 0)
    : [];
  if (to.length === 0) {
    return {
      status: "error",
      message: "No recipients were provided. Please specify email recipients."
    };
  }

  const message: SendMailMessage = {
    subject: typeof env.params.subject === "string" ? env.params.subject : "(no subject)",
    body: {
      contentType: "Text",
      content: typeof env.params.body === "string" ? env.params.body : ""
    },
    toRecipients: to.map((addr) => ({ emailAddress: { address: addr } }))
  };

  await graph.post("/me/sendMail", { message, saveToSentItems: true });
  return {
    status: "ok",
    message: `Email sent to ${to.join(", ")}.`,
    artifacts: { to, subject: message.subject }
  };
}
