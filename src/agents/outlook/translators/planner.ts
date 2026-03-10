interface OutlookRetrievalPlan {
  action: "list_recent_emails" | "read_email" | "search_email";
  params: Record<string, string | number>;
}

export function planOutlookRetrieval(input: unknown): OutlookRetrievalPlan {
  const lower = String(input ?? "").toLowerCase();
  if (lower.includes("read") && (lower.includes("latest") || lower.includes("last") || lower.includes("recent"))) {
    const m = lower.match(/\b(?:last|latest)\s+(\d{1,2})\b/);
    const limit = m ? Math.min(50, Math.max(1, Number(m[1]) || 1)) : 1;
    return { action: "list_recent_emails", params: { limit } };
  }
  if (lower.includes("read") && (lower.includes("email") || lower.includes("message") || lower.includes("inbox"))) {
    return { action: "read_email", params: { reference: "latest" } };
  }
  return { action: "search_email", params: { query: String(input ?? "") } };
}
