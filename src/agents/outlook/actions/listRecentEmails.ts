// @ts-nocheck
export async function listRecentEmailsAction(env, ctx) {
  const graph = ctx.graphClient;
  const limit = clampLimit(env.params?.limit);
  const path =
    "/me/messages" +
    `?$top=${limit}` +
    "&$orderby=receivedDateTime desc" +
    "&$select=id,subject,from,receivedDateTime,bodyPreview";
  const data = await graph.get(path);
  const messages = (data.value ?? []).map((m) => ({
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

function clampLimit(value) {
  const n = Number(value);
  if (Number.isNaN(n) || n < 1) return 5;
  return Math.min(50, Math.floor(n));
}
