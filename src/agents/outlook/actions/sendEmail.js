export async function sendEmailAction(env, ctx) {
  const graph = ctx.graphClient;
  const to = Array.isArray(env.params?.to) ? env.params.to : [];
  if (to.length === 0) {
    return {
      status: "error",
      message: "No recipients were provided. Please specify email recipients."
    };
  }

  const message = {
    subject: env.params.subject || "(no subject)",
    body: {
      contentType: "Text",
      content: env.params.body || ""
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
