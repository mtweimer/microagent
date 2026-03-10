import { fetchTeamsMessages, type FetchCoverage, type TeamsFetchResult, type TeamsMessageRow } from "./_teamsGraph.js";
import { normalizeTeamsParams } from "./_teamsParams.js";
import { looksLikeMention, whyRanked } from "./_teamsRanking.js";
import type { ActionEnvelope, AgentExecutionContext, AgentExecutionResult } from "../../../core/contracts.js";

function emptyCoverage(): FetchCoverage {
  return {
    chatsScanned: 0,
    chatMessagesScanned: 0,
    teamsScanned: 0,
    channelsScanned: 0,
    channelMessagesScanned: 0,
    totalCandidates: 0
  };
}

export async function searchMentionsAction(
  env: ActionEnvelope,
  ctx: AgentExecutionContext
): Promise<AgentExecutionResult> {
  const graph = ctx.graphClient;
  const teamsIndex = ctx.teamsIndex;
  const params = normalizeTeamsParams(env.params, { top: 30, surface: "both", window: "today", depth: "balanced" });
  let data: TeamsFetchResult | undefined;
  if (teamsIndex) {
    const indexed = teamsIndex.searchMessages?.({
      query: "",
      top: params.top,
      window: params.window,
      surface: params.surface
    });
    const indexedRecord = indexed as unknown as {
      messages?: TeamsMessageRow[];
      coverage?: FetchCoverage;
      limitations?: string[];
      sources?: string[];
    } | undefined;
    if ((indexedRecord?.messages?.length ?? 0) > 0) {
      data = {
        messages: (indexedRecord?.messages ?? []) as TeamsMessageRow[],
        catalog: { chats: [], teams: [], channels: [] },
        coverage: indexedRecord?.coverage ?? emptyCoverage(),
        limitations: indexedRecord?.limitations ?? [],
        sources: indexedRecord?.sources ?? ["teams.local_index"]
      };
    }
  }
  if (!data) {
    data = await fetchTeamsMessages(graph, params);
  }
  const rows = data.messages;
  const mentions = rows
    .filter(
      (m) =>
        looksLikeMention(m.bodyPreview) ||
        (Array.isArray(m.mentions) && m.mentions.some((x) => looksLikeMention(x)))
    )
    .slice(0, 10)
    .map((m) => ({ ...m, why: whyRanked(m) }));

  return {
    status: "ok",
    message: `Found ${mentions.length} possible mention/action message(s).`,
    artifacts: {
      sources: data.sources,
      limitations: data.limitations,
      coverage: data.coverage,
      params: {
        top: params.top,
        surface: params.surface,
        window: params.window,
        depth: params.depth
      },
      total: rows.length,
      mentions
    }
  };
}
