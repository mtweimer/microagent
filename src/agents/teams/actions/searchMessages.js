import { fetchTeamsMessages } from "./_teamsGraph.js";
import { normalizeTeamsParams } from "./_teamsParams.js";
import { buildSearchBlob, rankTeamsEntityCandidates, rankTeamsMessagesByQuery } from "./_teamsRanking.js";

export async function searchMessagesAction(env, ctx) {
  const graph = ctx.graphClient;
  const teamsIndex = ctx.teamsIndex;
  const rankingOptions = ctx.teamsRankingConfig ?? {};
  const params = normalizeTeamsParams(env.params, { top: 30, surface: "both", window: "30d", depth: "balanced" });
  const query = params.query;
  if (!query) {
    return {
      status: "error",
      message: "Teams search requires a query."
    };
  }
  let data;
  if (teamsIndex) {
    const indexed = teamsIndex.searchMessages({
      query,
      top: params.top,
      window: params.window,
      surface: params.surface,
      team: params.team,
      channel: params.channel,
      sender: params.sender,
      since: params.since,
      until: params.until,
      importance: params.importance
    });
    if ((indexed.messages?.length ?? 0) > 0 || (indexed.fallbackMatches?.length ?? 0) > 0) {
      data = {
        messages: indexed.messages ?? [],
        catalog: { chats: [], teams: [], channels: [] },
        coverage: indexed.coverage ?? {},
        limitations: indexed.limitations ?? [],
        sources: indexed.sources ?? ["teams.local_index"],
        fallbackMatches: indexed.fallbackMatches ?? []
      };
    }
  }
  if (!data) {
    data = await fetchTeamsMessages(graph, { ...params, query });
  }
  const rows = data.messages;
  const queryTokens = tokenizeQuery(query);
  const memoryHints = collectMemoryHints(ctx.memory, query);
  const hits = rankTeamsMessagesByQuery(rows, query, {
    limit: 10,
    memoryHints,
    options: rankingOptions
  });
  const searchableMatches = rows
    .map((row) => ({ id: row.id, searchable: buildSearchBlob(row).toLowerCase() }))
    .filter((r) => queryTokens.every((t) => r.searchable.includes(t)))
    .length;
  const fallbackMatches = hits.length === 0
    ? data.fallbackMatches?.length
      ? data.fallbackMatches
      : rankTeamsEntityCandidates(data.catalog, query, 5)
    : [];

  return {
    status: "ok",
    message: `Found ${hits.length} Teams message(s) matching '${query}'.`,
    artifacts: {
      sources: data.sources,
      limitations: data.limitations,
      coverage: data.coverage,
      params: {
        top: params.top,
        surface: params.surface,
        window: params.window,
        depth: params.depth,
        team: params.team,
        channel: params.channel,
        sender: params.sender,
        since: params.since,
        until: params.until,
        importance: params.importance
      },
      query,
      queryTokens,
      total: rows.length,
      searchableMatches,
      fallbackMatches,
      hits
    }
  };
}

function tokenizeQuery(query) {
  return String(query ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function collectMemoryHints(memory, query) {
  if (!memory || typeof memory.query !== "function") return [];
  try {
    const results = memory.query(query, { topK: 5 })?.results ?? [];
    return results.map((r) => String(r?.text ?? "")).slice(0, 5);
  } catch {
    return [];
  }
}
