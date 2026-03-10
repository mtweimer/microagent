// @ts-nocheck
import { fetchTeamsMessages } from "./_teamsGraph.js";
import { normalizeTeamsParams } from "./_teamsParams.js";
import { looksLikeMention, whyRanked } from "./_teamsRanking.js";

export async function searchMentionsAction(env, ctx) {
  const graph = ctx.graphClient;
  const teamsIndex = ctx.teamsIndex;
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
