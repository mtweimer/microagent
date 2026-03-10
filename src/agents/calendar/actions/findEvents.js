function resolveRange(timeRange, now = new Date()) {
  const lower = String(timeRange ?? "upcoming").toLowerCase();
  const start = new Date(now);
  const end = new Date(now);
  if (lower.includes("today")) {
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  if (lower.includes("tomorrow")) {
    start.setDate(start.getDate() + 1);
    end.setDate(end.getDate() + 1);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  if (lower.includes("week")) {
    start.setHours(0, 0, 0, 0);
    end.setDate(end.getDate() + 7);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  start.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + 14);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

export async function findEventsAction(env, ctx) {
  const graph = ctx.graphClient;
  const range = resolveRange(env.params?.timeRange, new Date());
  const startDateTime = encodeURIComponent(range.start.toISOString());
  const endDateTime = encodeURIComponent(range.end.toISOString());
  const path =
    "/me/calendarView" +
    `?startDateTime=${startDateTime}` +
    `&endDateTime=${endDateTime}` +
    "&$top=25" +
    "&$select=subject,start,end,webLink,isOnlineMeeting,onlineMeeting,location,bodyPreview" +
    "&$orderby=start/dateTime";
  const data = await graph.get(path);
  const events = (data.value ?? []).map((e) => ({
    subject: e.subject,
    start: e.start,
    end: e.end,
    webLink: e.webLink,
    isOnlineMeeting: Boolean(e.isOnlineMeeting),
    onlineMeetingUrl: e.onlineMeeting?.joinUrl ?? null,
    location: e.location?.displayName ?? null,
    bodyPreview: e.bodyPreview ?? null
  }));

  return {
    status: "ok",
    message: `Found ${events.length} event(s).`,
    artifacts: { timeRange: env.params?.timeRange, range, events }
  };
}
