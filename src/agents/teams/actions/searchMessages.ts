import { fetchTeamsMessages, type FetchCoverage, type TeamsFetchResult, type TeamsMessageRow } from "./_teamsGraph.js";
import { normalizeTeamsParams, type TeamsParams } from "./_teamsParams.js";
import { buildSearchBlob, rankTeamsEntityCandidates, rankTeamsMessagesByQuery } from "./_teamsRanking.js";
import type { ActionEnvelope, AgentExecutionContext, AgentExecutionResult, MemoryQueryHit } from "../../../core/contracts.js";

interface TeamsEntityCatalogRow {
  type?: string | undefined;
  id?: string | null | undefined;
  label?: string | null | undefined;
  name?: string | null | undefined;
  teamId?: string | null | undefined;
  teamName?: string | null | undefined;
  channelId?: string | null | undefined;
  channelName?: string | null | undefined;
  webUrl?: string | null | undefined;
}

type SearchFetchResult = TeamsFetchResult & {
  catalog: { chats: TeamsEntityCatalogRow[]; teams: TeamsEntityCatalogRow[]; channels: TeamsEntityCatalogRow[] };
  fallbackMatches?: unknown[];
};

interface IndexedSearchResult {
  messages?: TeamsMessageRow[];
  coverage?: FetchCoverage;
  limitations?: string[];
  sources?: string[];
  fallbackMatches?: unknown[];
}

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

export async function searchMessagesAction(
  env: ActionEnvelope,
  ctx: AgentExecutionContext
): Promise<AgentExecutionResult> {
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
  let data: SearchFetchResult | undefined;
  if (teamsIndex) {
    const indexed = teamsIndex.searchMessages?.({
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
    const indexedRecord = indexed as unknown as IndexedSearchResult | undefined;
    if ((indexedRecord?.messages?.length ?? 0) > 0 || (indexedRecord?.fallbackMatches?.length ?? 0) > 0) {
      data = {
        messages: (indexedRecord?.messages ?? []) as TeamsMessageRow[],
        catalog: { chats: [], teams: [], channels: [] },
        coverage: indexedRecord?.coverage ?? emptyCoverage(),
        limitations: indexedRecord?.limitations ?? [],
        sources: indexedRecord?.sources ?? ["teams.local_index"],
        fallbackMatches: indexedRecord?.fallbackMatches ?? []
      };
    }
  }
  if (!data) {
    data = (await fetchTeamsMessages(graph, { ...params, query })) as SearchFetchResult;
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

function tokenizeQuery(query: string): string[] {
  return String(query ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function collectMemoryHints(
  memory: AgentExecutionContext["memory"],
  query: string
): string[] {
  if (!memory || typeof memory.query !== "function") return [];
  try {
    const results = memory.query(query, { topK: 5 })?.results ?? [];
    return (results as MemoryQueryHit[]).map((r) => String(r?.text ?? "")).slice(0, 5);
  } catch {
    return [];
  }
}
