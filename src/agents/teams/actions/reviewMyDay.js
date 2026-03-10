import { fetchTeamsMessages } from "./_teamsGraph.js";
import { normalizeTeamsParams } from "./_teamsParams.js";
import { rankTeamsMessages, whyRanked } from "./_teamsRanking.js";

export async function reviewMyDayAction(env, ctx) {
  const graph = ctx.graphClient;
  const teamsIndex = ctx.teamsIndex;
  const rankingOptions = ctx.teamsRankingConfig ?? {};
  const params = normalizeTeamsParams(env.params, { top: 30, surface: "both", window: "today", depth: "balanced" });
  let data;
  if (teamsIndex) {
    const indexed = teamsIndex.searchMessages({
      query: "",
      top: params.top,
      window: params.window,
      surface: params.surface
    });
    if ((indexed.messages?.length ?? 0) > 0) {
      data = {
        messages: indexed.messages ?? [],
        coverage: indexed.coverage ?? {},
        limitations: indexed.limitations ?? [],
        sources: indexed.sources ?? ["teams.local_index"]
      };
    }
  }
  if (!data) {
    data = await fetchTeamsMessages(graph, params);
  }
  const rows = data.messages;
  const prioritized = rankTeamsMessages(rows, 10, rankingOptions).map((m) => ({
    ...m,
    why: whyRanked(m)
  }));

  return {
    status: "ok",
    message: `Reviewed ${rows.length} Teams message(s).`,
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
      prioritized
    }
  };
}
