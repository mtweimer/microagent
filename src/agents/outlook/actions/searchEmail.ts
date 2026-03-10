// @ts-nocheck
export async function searchEmailAction(env, ctx) {
  const graph = ctx.graphClient;
  const search = buildSearchSpec(env.params?.query ?? "");
  const data = await graph.get(search.path);
  const messages = (data.value ?? []).map((m) => ({
    id: m.id,
    subject: m.subject,
    from: m.from?.emailAddress?.address,
    receivedDateTime: m.receivedDateTime
  }));

  return {
    status: "ok",
    message: `Found ${messages.length} email(s).`,
    artifacts: { query: env.params?.query, searchMode: search.mode, messages }
  };
}

export function buildSearchSpec(query) {
  const q = String(query ?? "").trim();
  const lower = q.toLowerCase();
  const hasUnread = lower.includes("unread");
  const hasToday = lower.includes("today");
  const wantsLatest = lower.includes("latest") || lower.includes("recent") || lower.includes("last ");
  const top = extractTopN(lower) ?? 10;

  const parts = [`$top=${top}`];
  const filters = [];
  if (hasUnread) filters.push("isRead eq false");
  if (hasToday) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    filters.push(`receivedDateTime ge ${start.toISOString()}`);
    filters.push(`receivedDateTime le ${end.toISOString()}`);
  }

  if (filters.length > 0) {
    parts.push("$orderby=receivedDateTime desc");
    parts.push(`$filter=${encodeURIComponent(filters.join(" and "))}`);
    return {
      mode: hasUnread && hasToday ? "filter_unread_today" : hasUnread ? "filter_unread" : "filter_today",
      path: `/me/messages?${parts.join("&")}`
    };
  }

  if (wantsLatest) {
    parts.push("$orderby=receivedDateTime desc");
    return {
      mode: "top_n_recent",
      path: `/me/messages?${parts.join("&")}`
    };
  }

  const encoded = encodeURIComponent(q);
  parts.unshift(`$search="${encoded}"`);
  return {
    mode: "search",
    path: `/me/messages?${parts.join("&")}`
  };
}

function extractTopN(text) {
  const m = text.match(/\b(?:last|latest)\s+(\d{1,2})\b/);
  if (!m) return null;
  const n = Number(m[1]);
  if (Number.isNaN(n) || n < 1) return null;
  return Math.min(50, n);
}
