import { GraphClient } from "./graphClient.js";
import type { GraphClientOptions } from "./graphClient.js";

interface GraphProfile {
  graph?: {
    scopes?: string[];
  };
}

interface GraphFactoryResult {
  enabled: boolean;
  reason?: string;
  client?: GraphClient;
}

export function createGraphClient(profile: GraphProfile, env: NodeJS.ProcessEnv = process.env): GraphFactoryResult {
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

  const options: GraphClientOptions = {
    clientId,
    tenantId,
    scopes,
    cachePath: "./data/graph-token.json",
    baseDir: env.MICRO_CLAW_HOME || process.cwd()
  };

  return {
    enabled: true,
    client: new GraphClient(options)
  };
}
