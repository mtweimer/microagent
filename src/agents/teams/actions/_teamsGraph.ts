// @ts-nocheck
function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function depthConfig(depth = "balanced") {
  const key = String(depth ?? "balanced").toLowerCase();
  if (key === "full") {
    return {
      maxChats: 50,
      perChat: 50,
      maxTeams: 100,
      maxChannelsPerTeam: 20,
      perChannel: 25
    };
  }
  if (key === "fast") {
    return {
      maxChats: 8,
      perChat: 2,
      maxTeams: 4,
      maxChannelsPerTeam: 2,
      perChannel: 3
    };
  }
  if (key === "deep") {
    return {
      maxChats: 30,
      perChat: 8,
      maxTeams: 20,
      maxChannelsPerTeam: 8,
      perChannel: 10
    };
  }
  return {
    maxChats: 15,
    perChat: 4,
    maxTeams: 10,
    maxChannelsPerTeam: 4,
    perChannel: 5
  };
}

function windowStart(window) {
  const now = new Date();
  const key = String(window ?? "today").toLowerCase();
  if (key === "all") return null;
  if (key === "30d") return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (key === "7d") return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (key === "48h") return new Date(now.getTime() - 48 * 60 * 60 * 1000);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}

function toDate(value) {
  const d = new Date(value ?? 0);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function isWithinWindow(value, since) {
  if (!since) return true;
  const d = toDate(value);
  if (!d) return false;
  return d.getTime() >= since.getTime();
}

function fromDisplayName(raw) {
  return raw?.from?.user?.displayName ?? raw?.from?.application?.displayName ?? "unknown";
}

function stripHtml(value) {
  const text = String(value ?? "");
  return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function tokenizeQuery(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function nameScore(value, queryTokens) {
  const lower = String(value ?? "").toLowerCase();
  if (!lower || queryTokens.length === 0) return 0;
  let hits = 0;
  for (const token of queryTokens) {
    if (lower.includes(token)) hits += 1;
  }
  if (hits === 0) return 0;
  return hits === queryTokens.length ? 10 + hits : hits;
}

function prioritizeByQuery(rows, toName, queryTokens) {
  if (!Array.isArray(rows) || queryTokens.length === 0) return rows ?? [];
  return [...rows].sort((a, b) => {
    const sa = nameScore(toName(a), queryTokens);
    const sb = nameScore(toName(b), queryTokens);
    if (sb !== sa) return sb - sa;
    return String(toName(a)).localeCompare(String(toName(b)));
  });
}

const CHAT_FAILURE_TRACKER = new Map();
const CHAT_BACKOFF_MS = 10 * 60 * 1000;
const CHAT_FAILURE_THRESHOLD = 2;

function shouldSkipChat(chatId) {
  const state = CHAT_FAILURE_TRACKER.get(chatId);
  if (!state) return false;
  if (state.failures < CHAT_FAILURE_THRESHOLD) return false;
  return Date.now() - state.lastFailureAt < CHAT_BACKOFF_MS;
}

function markChatFailure(chatId) {
  const current = CHAT_FAILURE_TRACKER.get(chatId) ?? { failures: 0, lastFailureAt: 0 };
  CHAT_FAILURE_TRACKER.set(chatId, { failures: current.failures + 1, lastFailureAt: Date.now() });
}

function clearChatFailure(chatId) {
  CHAT_FAILURE_TRACKER.delete(chatId);
}

function scopeMatch(value, filter) {
  const v = String(value ?? "").toLowerCase().trim();
  const f = String(filter ?? "").toLowerCase().trim();
  if (!f) return true;
  return v.includes(f);
}

function inTeamScope(team, teamFilter) {
  if (!teamFilter) return true;
  return scopeMatch(team?.displayName, teamFilter) || String(team?.id ?? "").toLowerCase() === String(teamFilter).toLowerCase();
}

function inChannelScope(channel, channelFilter) {
  if (!channelFilter) return true;
  return (
    scopeMatch(channel?.displayName, channelFilter) ||
    String(channel?.id ?? "").toLowerCase() === String(channelFilter).toLowerCase()
  );
}

function inTimeRange(value, sinceIso, untilIso) {
  const d = toDate(value);
  if (!d) return false;
  if (sinceIso) {
    const since = toDate(sinceIso);
    if (since && d.getTime() < since.getTime()) return false;
  }
  if (untilIso) {
    const until = toDate(untilIso);
    if (until && d.getTime() > until.getTime()) return false;
  }
  return true;
}

function matchesAdvancedFilters(msg, { sender = "", since = "", until = "", importance = "" } = {}) {
  if (sender && !scopeMatch(msg.from, sender)) return false;
  if (importance && String(msg.importance ?? "").toLowerCase() !== String(importance).toLowerCase()) return false;
  if ((since || until) && !inTimeRange(msg.createdDateTime, since, until)) return false;
  return true;
}

function mapChatMessage(m, meta = {}) {
  const mentions = Array.isArray(m.mentions) ? m.mentions.map((x) => x?.mentionText).filter(Boolean) : [];
  const attachmentNames = Array.isArray(m.attachments) ? m.attachments.map((x) => x?.name).filter(Boolean) : [];
  return {
    id: m.id,
    sourceType: "chat",
    sourcePath: meta.sourcePath ?? null,
    from: fromDisplayName(m),
    createdDateTime: m.createdDateTime,
    importance: m.importance ?? "normal",
    webUrl: m.webUrl ?? null,
    subject: m.subject ?? null,
    summary: m.summary ?? null,
    bodyPreview: m.bodyPreview ?? stripHtml(m.body?.content ?? ""),
    mentions,
    attachmentNames,
    chatId: meta.chatId ?? null,
    chatTopic: meta.chatTopic ?? null,
    teamId: null,
    teamName: null,
    channelId: null,
    channelName: null
  };
}

function mapChannelMessage(m, meta = {}) {
  const mentions = Array.isArray(m.mentions) ? m.mentions.map((x) => x?.mentionText).filter(Boolean) : [];
  const attachmentNames = Array.isArray(m.attachments) ? m.attachments.map((x) => x?.name).filter(Boolean) : [];
  return {
    id: m.id,
    sourceType: "channel",
    sourcePath: meta.sourcePath ?? null,
    from: fromDisplayName(m),
    createdDateTime: m.createdDateTime,
    importance: m.importance ?? "normal",
    webUrl: m.webUrl ?? null,
    subject: m.subject ?? null,
    summary: m.summary ?? null,
    bodyPreview: stripHtml(m.body?.content ?? m.summary ?? m.subject ?? ""),
    mentions,
    attachmentNames,
    chatId: null,
    chatTopic: null,
    teamId: meta.teamId ?? null,
    teamName: meta.teamName ?? null,
    channelId: meta.channelId ?? null,
    channelName: meta.channelName ?? null
  };
}

function dedupeMessages(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = `${row.sourceType}:${row.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function sortNewest(rows) {
  return [...rows].sort((a, b) => String(b.createdDateTime).localeCompare(String(a.createdDateTime)));
}

async function collectChatMessages(
  graph,
  { top, depth, sinceWindow, sinceFilter, untilFilter, queryTokens, team, channel, sender, importance }
) {
  const cfg = depthConfig(depth);
  const rows = [];
  const sources = [];
  const limitations = [];
  const coverage = {
    chatsScanned: 0,
    chatMessagesScanned: 0
  };
  const catalog = { chats: [] };

  const primaryPath = `/me/chats/getAllMessages?$top=${top}`;
  try {
    const data = await graph.get(primaryPath);
    sources.push("me.chats.getAllMessages");
    for (const raw of data.value ?? []) {
      coverage.chatMessagesScanned += 1;
      const mapped = mapChatMessage(raw, { sourcePath: "me.chats.getAllMessages" });
      if (
        isWithinWindow(mapped.createdDateTime, sinceWindow) &&
        matchesAdvancedFilters(mapped, { sender, since: sinceFilter, until: untilFilter, importance })
      ) {
        rows.push(mapped);
      }
      if (rows.length >= top) break;
    }
    return { rows, sources, limitations, coverage, catalog };
  } catch (error) {
    if (!shouldUseDelegatedFallback(error)) throw error;
    limitations.push("getAllMessages unsupported in delegated context; used chat fallback");
  }

  const chatsData = await getChats(graph, cfg.maxChats);
  sources.push("me.chats.messages_fallback");
  const chats = prioritizeByQuery(chatsData.value ?? [], (c) => c?.topic ?? "", queryTokens);
  coverage.chatsScanned = chats.length;
  catalog.chats = chats.map((chat) => ({
    id: chat?.id ?? null,
    label: chat?.topic ?? "direct",
    webUrl: chat?.webUrl ?? null
  }));
  for (const chat of chats) {
    if (team || channel) {
      const topic = chat?.topic ?? "";
      const scopeText = [team, channel].filter(Boolean).join(" ");
      if (!scopeMatch(topic, scopeText)) continue;
    }
    if (shouldSkipChat(chat.id)) {
      limitations.push(`skipped unstable chat ${chat.id}; backoff active`);
      continue;
    }
    const chatId = encodeURIComponent(chat.id);
    const msgPath =
      `/me/chats/${chatId}/messages` +
      `?$top=${cfg.perChat}` +
      "&$select=id,createdDateTime,from,importance,webUrl,subject,summary,bodyPreview,body,mentions,attachments";
    try {
      const msgData = await graph.get(msgPath);
      clearChatFailure(chat.id);
      for (const raw of msgData.value ?? []) {
        coverage.chatMessagesScanned += 1;
        const mapped = mapChatMessage(raw, {
          chatId: chat.id,
          chatTopic: chat.topic ?? null,
          sourcePath: "me.chats.messages_fallback"
        });
        if (
          isWithinWindow(mapped.createdDateTime, sinceWindow) &&
          matchesAdvancedFilters(mapped, { sender, since: sinceFilter, until: untilFilter, importance })
        ) {
          rows.push(mapped);
        }
        if (rows.length >= top) break;
      }
    } catch {
      markChatFailure(chat.id);
      limitations.push(`failed reading chat ${chat.id}; continued`);
    }
    if (rows.length >= top) break;
  }

  return { rows, sources, limitations, coverage, catalog };
}

async function collectChannelMessages(
  graph,
  { top, depth, sinceWindow, sinceFilter, untilFilter, queryTokens, team, channel, sender, importance }
) {
  const cfg = depthConfig(depth);
  const rows = [];
  const limitations = [];
  const coverage = {
    teamsScanned: 0,
    channelsScanned: 0,
    channelMessagesScanned: 0
  };
  const catalog = { teams: [], channels: [] };
  const sources = [];

  try {
    const teamsData = await getJoinedTeams(graph, cfg.maxTeams);
    const teams = prioritizeByQuery(teamsData.value ?? [], (t) => t?.displayName ?? "", queryTokens).filter((t) =>
      inTeamScope(t, team)
    );
    coverage.teamsScanned = teams.length;
    catalog.teams = teams.map((team) => ({
      id: team?.id ?? null,
      label: team?.displayName ?? "",
      webUrl: team?.webUrl ?? null
    }));
    sources.push("me.joinedTeams");

    for (const team of teams) {
      if (!team?.id) continue;
      const teamId = encodeURIComponent(team.id);
      let channels = [];
      try {
        const channelsData = await getTeamChannels(graph, teamId, cfg.maxChannelsPerTeam);
        channels = prioritizeByQuery(channelsData.value ?? [], (c) => c?.displayName ?? "", queryTokens).filter((c) =>
          inChannelScope(c, channel)
        );
      } catch {
        limitations.push(`failed reading channels for team ${team.id}; continued`);
      }
      coverage.channelsScanned += channels.length;
      for (const channel of channels) {
        catalog.channels.push({
          id: channel?.id ?? null,
          label: channel?.displayName ?? "",
          teamId: team?.id ?? null,
          teamName: team?.displayName ?? null,
          channelId: channel?.id ?? null,
          channelName: channel?.displayName ?? null,
          webUrl: channel?.webUrl ?? null
        });
      }

      for (const channel of channels) {
        if (!channel?.id) continue;
        const channelId = encodeURIComponent(channel.id);
        try {
          const msgData = await getChannelMessages(graph, teamId, channelId, cfg.perChannel);
          sources.push("teams.channels.messages");
          for (const raw of msgData.value ?? []) {
            coverage.channelMessagesScanned += 1;
            const mapped = mapChannelMessage(raw, {
              teamId: team.id,
              teamName: team.displayName ?? null,
              channelId: channel.id,
              channelName: channel.displayName ?? null,
              sourcePath: "teams.channels.messages"
            });
            if (
              isWithinWindow(mapped.createdDateTime, sinceWindow) &&
              matchesAdvancedFilters(mapped, { sender, since: sinceFilter, until: untilFilter, importance })
            ) {
              rows.push(mapped);
            }
            if (rows.length >= top) break;
          }
        } catch (error) {
          const text = String(error?.message ?? error);
          if (text.includes("403")) limitations.push("missing scope for channel messages");
          else limitations.push(`failed reading messages in ${team.id}/${channel.id}; continued`);
        }
        if (rows.length >= top) break;
      }
      if (rows.length >= top) break;
    }
  } catch (error) {
    limitations.push(`channel retrieval unavailable: ${String(error?.message ?? error)}`);
  }

  return { rows, sources, limitations, coverage, catalog };
}

export async function fetchTeamsMessages(
  graph,
  {
    top = 25,
    surface = "both",
    window = "today",
    depth = "balanced",
    query = "",
    team = "",
    channel = "",
    sender = "",
    since = "",
    until = "",
    importance = ""
  } = {}
) {
  const limit = clamp(top, 1, 5000, 25);
  const sinceWindow = windowStart(window);
  const sinceFilter = String(since ?? "").trim();
  const untilFilter = String(until ?? "").trim();
  const mode = String(surface ?? "both").toLowerCase();
  const queryTokens = tokenizeQuery(query);

  const rows = [];
  const sources = [];
  const limitations = [];
  const coverage = {
    chatsScanned: 0,
    chatMessagesScanned: 0,
    teamsScanned: 0,
    channelsScanned: 0,
    channelMessagesScanned: 0,
    totalCandidates: 0
  };
  const catalog = { chats: [], teams: [], channels: [] };

  if (mode === "chats" || mode === "both") {
    const chat = await collectChatMessages(graph, {
      top: limit,
      depth,
      sinceWindow,
      sinceFilter,
      untilFilter,
      queryTokens,
      team,
      channel,
      sender,
      importance
    });
    rows.push(...chat.rows);
    sources.push(...chat.sources);
    limitations.push(...chat.limitations);
    coverage.chatsScanned += chat.coverage.chatsScanned;
    coverage.chatMessagesScanned += chat.coverage.chatMessagesScanned;
    catalog.chats.push(...(chat.catalog?.chats ?? []));
  }

  if (mode === "channels" || mode === "both") {
    const channelData = await collectChannelMessages(graph, {
      top: limit,
      depth,
      sinceWindow,
      sinceFilter,
      untilFilter,
      queryTokens,
      team,
      channel,
      sender,
      importance
    });
    rows.push(...channelData.rows);
    sources.push(...channelData.sources);
    limitations.push(...channelData.limitations);
    coverage.teamsScanned += channelData.coverage.teamsScanned;
    coverage.channelsScanned += channelData.coverage.channelsScanned;
    coverage.channelMessagesScanned += channelData.coverage.channelMessagesScanned;
    catalog.teams.push(...(channelData.catalog?.teams ?? []));
    catalog.channels.push(...(channelData.catalog?.channels ?? []));
  }

  const unique = sortNewest(dedupeMessages(rows)).slice(0, limit);
  coverage.totalCandidates = unique.length;

  return {
    messages: unique,
    sources: [...new Set(sources)],
    coverage,
    limitations: [...new Set(limitations)],
    catalog: {
      chats: dedupeCatalog(catalog.chats),
      teams: dedupeCatalog(catalog.teams),
      channels: dedupeCatalog(catalog.channels)
    }
  };
}

function dedupeCatalog(rows = []) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = `${row.id ?? ""}:${row.teamId ?? ""}:${row.channelId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export async function probeTeamsAccess(graph) {
  const probes = {};
  probes.chats = await runProbe(graph, "/me/chats?$top=1&$select=id,topic");
  probes.chatMessages = await runProbe(graph, "/me/chats/getAllMessages?$top=1");

  const joinedTeams = await runJoinedTeamsProbe(graph);
  probes.joinedTeams = joinedTeams;
  if (!joinedTeams.ok) {
    probes.channels = { ok: false, skipped: true, reason: "joinedTeams probe failed" };
    probes.channelMessages = { ok: false, skipped: true, reason: "joinedTeams probe failed" };
    return probes;
  }

  const firstTeamId = joinedTeams.data?.value?.[0]?.id;
  if (!firstTeamId) {
    probes.channels = { ok: true, empty: true, endpoint: "/teams/{id}/channels" };
    probes.channelMessages = { ok: true, empty: true, endpoint: "/teams/{id}/channels/{id}/messages" };
    return probes;
  }

  const encTeam = encodeURIComponent(firstTeamId);
  const channels = await runChannelsProbe(graph, encTeam);
  probes.channels = channels;
  if (!channels.ok || !channels.data?.value?.[0]?.id) {
    probes.channelMessages = {
      ok: channels.ok,
      skipped: true,
      reason: channels.ok ? "no channels found" : "channels probe failed"
    };
    return probes;
  }

  const firstChannel = encodeURIComponent(channels.data.value[0].id);
  probes.channelMessages = await runChannelMessagesProbe(graph, encTeam, firstChannel);
  return probes;
}

async function runProbe(graph, path) {
  try {
    const data = await graph.get(path);
    return { ok: true, endpoint: path, count: Array.isArray(data?.value) ? data.value.length : 0, data };
  } catch (error) {
    return { ok: false, endpoint: path, error: String(error?.message ?? error) };
  }
}

async function runChannelMessagesProbe(graph, encTeam, encChannel) {
  const variants = [
    `/teams/${encTeam}/channels/${encChannel}/messages?$top=1&$select=id,createdDateTime`,
    `/teams/${encTeam}/channels/${encChannel}/messages?$top=1`,
    `/teams/${encTeam}/channels/${encChannel}/messages`
  ];
  for (const path of variants) {
    try {
      const data = await graph.get(path);
      return { ok: true, endpoint: path, count: Array.isArray(data?.value) ? data.value.length : 0, data };
    } catch (error) {
      if (isSelectNotAllowedError(error) || isTopNotAllowedError(error)) {
        continue;
      }
      return { ok: false, endpoint: path, error: String(error?.message ?? error) };
    }
  }
  return {
    ok: false,
    endpoint: variants[0],
    error: "Channel messages endpoint rejected supported query variants for this tenant."
  };
}

async function runJoinedTeamsProbe(graph) {
  const primary = "/me/joinedTeams?$top=1&$select=id,displayName";
  try {
    const data = await graph.get(primary);
    return { ok: true, endpoint: primary, count: Array.isArray(data?.value) ? data.value.length : 0, data };
  } catch (error) {
    if (!isTopNotAllowedError(error)) {
      return { ok: false, endpoint: primary, error: String(error?.message ?? error) };
    }
  }

  const fallback = "/me/joinedTeams?$select=id,displayName";
  try {
    const data = await graph.get(fallback);
    return {
      ok: true,
      endpoint: fallback,
      count: Array.isArray(data?.value) ? Math.min(1, data.value.length) : 0,
      data
    };
  } catch (error) {
    return { ok: false, endpoint: fallback, error: String(error?.message ?? error) };
  }
}

async function runChannelsProbe(graph, encTeam) {
  const primary = `/teams/${encTeam}/channels?$top=1&$select=id,displayName`;
  try {
    const data = await graph.get(primary);
    return { ok: true, endpoint: primary, count: Array.isArray(data?.value) ? data.value.length : 0, data };
  } catch (error) {
    if (!isTopNotAllowedError(error)) {
      return { ok: false, endpoint: primary, error: String(error?.message ?? error) };
    }
  }

  const fallback = `/teams/${encTeam}/channels?$select=id,displayName`;
  try {
    const data = await graph.get(fallback);
    return {
      ok: true,
      endpoint: fallback,
      count: Array.isArray(data?.value) ? Math.min(1, data.value.length) : 0,
      data
    };
  } catch (error) {
    return { ok: false, endpoint: fallback, error: String(error?.message ?? error) };
  }
}

async function getJoinedTeams(graph, limit) {
  const primary = `/me/joinedTeams?$top=${Math.max(1, Math.min(200, limit))}&$select=id,displayName`;
  try {
    return await graph.get(primary);
  } catch (error) {
    if (!isTopNotAllowedError(error)) throw error;
  }
  const fallback = "/me/joinedTeams?$select=id,displayName";
  const data = await graph.get(fallback);
  const rows = Array.isArray(data?.value) ? data.value.slice(0, Math.max(1, Math.min(200, limit))) : [];
  return { ...data, value: rows };
}

async function getChats(graph, limit) {
  const capped = Math.max(1, Math.min(50, Number(limit) || 15));
  const primary = `/me/chats?$top=${capped}&$select=id,topic,webUrl`;
  try {
    return await graph.get(primary);
  } catch (error) {
    if (!isTopExceededError(error) || capped === 50) throw error;
  }
  const fallback = "/me/chats?$top=50&$select=id,topic,webUrl";
  return await graph.get(fallback);
}

async function getTeamChannels(graph, encTeam, limit) {
  const primary = `/teams/${encTeam}/channels?$top=${Math.max(1, Math.min(200, limit))}&$select=id,displayName,webUrl`;
  try {
    return await graph.get(primary);
  } catch (error) {
    if (!isTopNotAllowedError(error)) throw error;
  }
  const fallback = `/teams/${encTeam}/channels?$select=id,displayName,webUrl`;
  const data = await graph.get(fallback);
  const rows = Array.isArray(data?.value) ? data.value.slice(0, Math.max(1, Math.min(200, limit))) : [];
  return { ...data, value: rows };
}

async function getChannelMessages(graph, encTeam, encChannel, limit) {
  const bounded = Math.max(1, Math.min(200, limit));
  const variants = [
    `/teams/${encTeam}/channels/${encChannel}/messages?$top=${bounded}&$select=id,createdDateTime,from,importance,webUrl,subject,summary,body,mentions,attachments`,
    `/teams/${encTeam}/channels/${encChannel}/messages?$top=${bounded}`,
    `/teams/${encTeam}/channels/${encChannel}/messages`
  ];

  for (const path of variants) {
    try {
      const data = await graph.get(path);
      if (path.endsWith("/messages")) {
        const rows = Array.isArray(data?.value) ? data.value.slice(0, bounded) : [];
        return { ...data, value: rows };
      }
      return data;
    } catch (error) {
      if (isSelectNotAllowedError(error) || isTopNotAllowedError(error)) continue;
      throw error;
    }
  }
  throw new Error("Graph channel messages endpoint rejected supported query variants.");
}

function isTopNotAllowedError(error) {
  const text = String(error?.message ?? error ?? "").toLowerCase();
  return text.includes("query option 'top' is not allowed");
}

function isTopExceededError(error) {
  const text = String(error?.message ?? error ?? "").toLowerCase();
  return text.includes("limit of '50' for top query has been exceeded");
}

function isSelectNotAllowedError(error) {
  const text = String(error?.message ?? error ?? "").toLowerCase();
  return text.includes("query option 'select' is not allowed");
}

function shouldUseDelegatedFallback(error) {
  const text = String(error?.message ?? error ?? "").toLowerCase();
  return (
    text.includes("preconditionfailed") ||
    text.includes("not supported in delegated context") ||
    text.includes("getallmessages")
  );
}
