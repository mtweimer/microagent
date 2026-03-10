function textScore(text) {
  const lower = String(text ?? "").toLowerCase();
  let score = 0;
  if (lower.includes("urgent")) score += 4;
  if (lower.includes("asap")) score += 4;
  if (lower.includes("action required")) score += 3;
  if (lower.includes("please")) score += 1;
  if (lower.includes("?")) score += 1;
  if (lower.includes("@")) score += 2;
  if (lower.includes("can you")) score += 2;
  if (lower.includes("please review")) score += 2;
  if (lower.includes("follow up")) score += 2;
  return score;
}

function normalizeRankingOptions(options = {}) {
  const penaltyPreset = String(options.automationPenalty ?? "moderate").toLowerCase();
  const automationPenalty =
    penaltyPreset === "aggressive" ? -4 : penaltyPreset === "neutral" ? 0 : -2;
  const mentionBoost = Number.isFinite(Number(options.mentionBoost)) ? Number(options.mentionBoost) : 2;
  const directedLanguageBoost = Number.isFinite(Number(options.directedLanguageBoost))
    ? Number(options.directedLanguageBoost)
    : 2;
  return {
    automationPenalty,
    mentionBoost,
    directedLanguageBoost
  };
}

function tokenize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function unique(values) {
  return [...new Set(values)];
}

export function buildSearchBlob(msg = {}) {
  const parts = [
    msg.bodyPreview,
    msg.subject,
    msg.summary,
    msg.teamName,
    msg.channelName,
    msg.chatTopic,
    msg.from,
    ...(Array.isArray(msg.mentions) ? msg.mentions : []),
    ...(Array.isArray(msg.attachmentNames) ? msg.attachmentNames : [])
  ]
    .map((x) => String(x ?? "").trim())
    .filter(Boolean);
  return parts.join(" | ");
}

function recencyScore(createdDateTime) {
  const ts = new Date(createdDateTime ?? 0).getTime();
  if (!ts || Number.isNaN(ts)) return 0;
  const ageHours = Math.max(0, (Date.now() - ts) / 3600000);
  if (ageHours <= 2) return 4;
  if (ageHours <= 8) return 3;
  if (ageHours <= 24) return 2;
  if (ageHours <= 72) return 1;
  return 0;
}

function isAutomationSender(sender) {
  const lower = String(sender ?? "").toLowerCase();
  return (
    lower.includes("workflows") ||
    lower.includes("power automate") ||
    lower.includes("noreply") ||
    lower.includes("no-reply") ||
    lower.includes("bot")
  );
}

function senderQualityScore(sender, options = {}) {
  const cfg = normalizeRankingOptions(options);
  return isAutomationSender(sender) ? cfg.automationPenalty : 1;
}

function importanceScore(importance) {
  const value = String(importance ?? "").toLowerCase();
  if (value === "high") return 2;
  if (value === "normal") return 1;
  return 0;
}

export function scoreTeamsMessage(msg, options = {}) {
  return (
    textScoreWithOptions(msg?.bodyPreview, options) +
    recencyScore(msg?.createdDateTime) +
    importanceScore(msg?.importance) +
    senderQualityScore(msg?.from, options)
  );
}

export function rankTeamsMessages(rows = [], limit = 10, options = {}) {
  return [...rows]
    .map((m) => ({ ...m, _score: scoreTeamsMessage(m, options) }))
    .sort((a, b) => b._score - a._score || String(b.createdDateTime).localeCompare(String(a.createdDateTime)))
    .slice(0, limit)
    .map(({ _score, ...rest }) => rest);
}

export function rankTeamsMessagesByQuery(rows = [], query = "", { limit = 10, memoryHints = [], options = {} } = {}) {
  const queryTokens = unique(tokenize(query));
  const hints = unique(memoryHints.flatMap((h) => tokenize(h))).slice(0, 30);

  const scored = rows
    .map((item) => scoreForQuery(item, queryTokens, hints, options))
    .filter((s) => s.match)
    .sort((a, b) => b.score - a.score || String(b.item.createdDateTime).localeCompare(String(a.item.createdDateTime)))
    .slice(0, limit);

  return scored.map((row) => ({
    ...row.item,
    why: row.why,
    score: row.score,
    scoreBreakdown: row.scoreBreakdown,
    searchableFieldsMatched: row.fields
  }));
}

export function rankTeamsEntityCandidates(catalog = {}, query = "", limit = 5) {
  const queryTokens = unique(tokenize(query));
  if (queryTokens.length === 0) return [];
  const rows = [
    ...(Array.isArray(catalog.teams) ? catalog.teams.map((x) => ({ ...x, type: "team" })) : []),
    ...(Array.isArray(catalog.channels) ? catalog.channels.map((x) => ({ ...x, type: "channel" })) : []),
    ...(Array.isArray(catalog.chats) ? catalog.chats.map((x) => ({ ...x, type: "chat" })) : [])
  ];

  return rows
    .map((row) => scoreEntityCandidate(row, queryTokens))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || String(a.label).localeCompare(String(b.label)))
    .slice(0, limit)
    .map((x) => ({
      type: x.type,
      id: x.id,
      label: x.label,
      teamId: x.teamId ?? null,
      teamName: x.teamName ?? null,
      channelId: x.channelId ?? null,
      channelName: x.channelName ?? null,
      webUrl: x.webUrl ?? null,
      score: x.score,
      why: x.why
    }));
}

export function looksLikeMention(text) {
  const lower = String(text ?? "").toLowerCase();
  return (
    lower.includes("@") ||
    lower.includes("michael") ||
    lower.includes("can you") ||
    lower.includes("please review") ||
    lower.includes("action required")
  );
}

export function whyRanked(msg) {
  const lower = String(msg?.bodyPreview ?? "").toLowerCase();
  const reasons = [];
  if (lower.includes("urgent") || lower.includes("asap")) reasons.push("urgent wording");
  if (lower.includes("@")) reasons.push("contains @ mention");
  if (lower.includes("can you") || lower.includes("please")) reasons.push("direct ask language");
  if (String(msg?.importance ?? "").toLowerCase() === "high") reasons.push("high importance");
  if (reasons.length === 0) reasons.push("recent message");
  return reasons.join(", ");
}

function scoreForQuery(item, queryTokens, memoryHintTokens, options = {}) {
  const cfg = normalizeRankingOptions(options);
  const fieldTexts = {
    bodyPreview: String(item.bodyPreview ?? "").toLowerCase(),
    subject: String(item.subject ?? "").toLowerCase(),
    summary: String(item.summary ?? "").toLowerCase(),
    teamName: String(item.teamName ?? "").toLowerCase(),
    channelName: String(item.channelName ?? "").toLowerCase(),
    chatTopic: String(item.chatTopic ?? "").toLowerCase(),
    from: String(item.from ?? "").toLowerCase(),
    mentions: (Array.isArray(item.mentions) ? item.mentions : []).join(" ").toLowerCase(),
    attachments: (Array.isArray(item.attachmentNames) ? item.attachmentNames : []).join(" ").toLowerCase()
  };

  const fields = [];
  let tokenHits = 0;
  for (const token of queryTokens) {
    let matched = false;
    for (const [field, text] of Object.entries(fieldTexts)) {
      if (!text || !text.includes(token)) continue;
      fields.push(field);
      matched = true;
    }
    if (matched) tokenHits += 1;
  }

  const bodyMatch = queryTokens.some((t) => fieldTexts.bodyPreview.includes(t));
  const nameMatch = queryTokens.some(
    (t) =>
      fieldTexts.teamName.includes(t) ||
      fieldTexts.channelName.includes(t) ||
      fieldTexts.chatTopic.includes(t)
  );
  const senderMatch = queryTokens.some((t) => fieldTexts.from.includes(t));

  const hintHits = memoryHintTokens.filter(
    (h) =>
      fieldTexts.bodyPreview.includes(h) ||
      fieldTexts.teamName.includes(h) ||
      fieldTexts.channelName.includes(h) ||
      fieldTexts.from.includes(h)
  ).length;

  const breakdown = {
    queryTokenHits: tokenHits * 4,
    bodyMatch: bodyMatch ? 3 : 0,
    nameMatch: nameMatch ? 4 : 0,
    senderMatch: senderMatch ? 2 : 0,
    memoryHintHits: Math.min(3, hintHits),
    urgency: textScoreWithOptions(item.bodyPreview, options),
    recency: recencyScore(item.createdDateTime),
    importance: importanceScore(item.importance),
    senderQuality: senderQualityScore(item.from, options)
  };

  const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const match = tokenHits > 0 || queryTokens.length === 0;
  const why = buildWhy(fieldTexts, breakdown, queryTokens, cfg);
  return {
    item,
    score,
    match,
    fields: unique(fields),
    scoreBreakdown: breakdown,
    why
  };
}

function buildWhy(fieldTexts, breakdown, queryTokens, cfg) {
  const reasons = [];
  if (breakdown.nameMatch > 0) reasons.push("matched team/channel name");
  if (breakdown.bodyMatch > 0) reasons.push("matched message content");
  if (breakdown.senderMatch > 0) reasons.push("matched sender");
  if (breakdown.memoryHintHits > 0) reasons.push("aligned with recent context");
  if (breakdown.urgency > 0) reasons.push("contains urgency/action language");
  if (cfg.automationPenalty < 0 && breakdown.senderQuality < 0) reasons.push("automation sender deprioritized");
  if (reasons.length === 0 && queryTokens.length > 0) {
    if (queryTokens.some((t) => fieldTexts.summary.includes(t) || fieldTexts.subject.includes(t))) {
      reasons.push("matched summary/subject");
    }
  }
  if (reasons.length === 0) reasons.push("recent message");
  return reasons.join(", ");
}

function textScoreWithOptions(text, options = {}) {
  const cfg = normalizeRankingOptions(options);
  const lower = String(text ?? "").toLowerCase();
  let score = textScore(text);
  if (lower.includes("@")) score += cfg.mentionBoost;
  if (lower.includes("can you") || lower.includes("please")) score += cfg.directedLanguageBoost;
  return score;
}

function scoreEntityCandidate(row, queryTokens) {
  const label = String(
    row?.type === "channel" ? `${row.teamName ?? ""} ${row.channelName ?? ""}` : row?.label ?? row?.name ?? ""
  )
    .replace(/\s+/g, " ")
    .trim();
  const searchable = label.toLowerCase();
  let tokenHits = 0;
  for (const token of queryTokens) {
    if (searchable.includes(token)) tokenHits += 1;
  }
  const allMatched = tokenHits === queryTokens.length;
  const partial = tokenHits > 0;
  const score = (allMatched ? 6 : 0) + tokenHits * 3 + (row.type === "channel" ? 1 : 0);
  let why = "name similarity";
  if (allMatched) why = "all query terms match workspace name";
  else if (partial) why = "partial query term match in workspace name";
  return {
    ...row,
    label,
    score: partial ? score : 0,
    why
  };
}
