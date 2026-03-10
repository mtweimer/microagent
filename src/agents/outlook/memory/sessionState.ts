// @ts-nocheck
export function createOutlookSessionState() {
  return {
    lastEmailId: null,
    lastEmailIds: []
  };
}

export function updateOutlookSessionState(state, result, action) {
  const next = { ...(state ?? createOutlookSessionState()) };
  if (action === "search_email" || action === "list_recent_emails") {
    const ids = (result?.artifacts?.messages ?? []).map((m) => m.id).filter(Boolean);
    if (ids.length > 0) {
      next.lastEmailId = ids[0];
      next.lastEmailIds = ids;
    }
  }
  if (action === "read_email" && result?.artifacts?.id) {
    next.lastEmailId = result.artifacts.id;
  }
  return next;
}
