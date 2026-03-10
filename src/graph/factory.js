import { GraphClient } from "./graphClient.js";

export function createGraphClient(profile, env = process.env) {
  const clientId = env.MSGRAPH_APP_CLIENTID;
  const tenantId = env.MSGRAPH_APP_TENANTID || "common";
  const scopes = profile?.graph?.scopes?.length
    ? profile.graph.scopes
    : ["User.Read", "Mail.Read", "Mail.Send", "Calendars.ReadWrite", "Chat.Read"];

  if (!clientId) {
    return {
      enabled: false,
      reason: "MSGRAPH_APP_CLIENTID is not configured"
    };
  }

  return {
    enabled: true,
    client: new GraphClient({
      clientId,
      tenantId,
      scopes,
      cachePath: "./data/graph-token.json",
      baseDir: env.MICRO_CLAW_HOME || process.cwd()
    })
  };
}
