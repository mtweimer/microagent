export async function readEmailAction(env, ctx) {
  const graph = ctx.graphClient;
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
  const message = await graph.get(path);
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

async function resolveReferenceId(graph, reference) {
  const data = await graph.get(
    "/me/messages?$top=2&$orderby=receivedDateTime desc&$select=id,subject,from,receivedDateTime,bodyPreview"
  );
  const messages = data.value ?? [];
  if (reference === "previous") return messages[1]?.id ?? "";
  return messages[0]?.id ?? "";
}
