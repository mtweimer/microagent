interface OutlookMessageRef {
  id?: string | null;
}

interface OutlookActionResult {
  artifacts?: {
    messages?: OutlookMessageRef[];
    id?: string | null;
  };
}

export interface OutlookSessionState {
  lastEmailId: string | null;
  lastEmailIds: string[];
}

export function createOutlookSessionState(): OutlookSessionState {
  return {
    lastEmailId: null,
    lastEmailIds: []
  };
}

export function updateOutlookSessionState(
  state: OutlookSessionState | null | undefined,
  result: OutlookActionResult | null | undefined,
  action: string
): OutlookSessionState {
  const next = { ...(state ?? createOutlookSessionState()) };
  if (action === "search_email" || action === "list_recent_emails") {
    const ids = (result?.artifacts?.messages ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    if (ids.length > 0) {
      next.lastEmailId = ids[0] ?? null;
      next.lastEmailIds = ids;
    }
  }
  if (action === "read_email" && result?.artifacts?.id) {
    next.lastEmailId = result.artifacts.id;
  }
  return next;
}
