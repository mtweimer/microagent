import {
  createOutlookSessionState,
  updateOutlookSessionState
} from "../../agents/outlook/memory/sessionState.js";

export function createSessionRefs() {
  return {
    outlook: createOutlookSessionState(),
    calendar: {
      lastEventSubject: null,
      lastEventLink: null,
      lastTimeRange: null
    },
    teams: {
      lastThreadId: null,
      lastMessageIds: [],
      lastTeam: null,
      lastChannel: null
    },
    review: {
      lastTarget: null,
      lastItems: []
    },
    entities: {
      lastNames: []
    }
  };
}

export function updateSessionRefsFromCached(sessionRefs, cachedResponse) {
  const next = { ...(sessionRefs ?? createSessionRefs()) };
  const cachedAction = cachedResponse?.artifacts?.action;
  if (cachedAction?.agent === "ms.outlook") {
    next.outlook = updateOutlookSessionState(
      next.outlook,
      { artifacts: cachedResponse?.artifacts?.result ?? {} },
      cachedAction.action
    );
  }
  if (cachedAction?.agent === "ms.calendar") {
    next.calendar = updateCalendarSessionState(next.calendar, cachedResponse?.artifacts?.result ?? {});
  }
  if (cachedAction?.agent === "ms.teams") {
    next.teams = updateTeamsSessionState(next.teams, cachedResponse?.artifacts?.result ?? {});
  }
  return next;
}

export function updateSessionRefsFromExecution(sessionRefs, envelope, result) {
  const next = { ...(sessionRefs ?? createSessionRefs()) };
  if (envelope?.agent === "ms.outlook") {
    next.outlook = updateOutlookSessionState(next.outlook, result, envelope.action);
  }
  if (envelope?.agent === "ms.calendar") {
    next.calendar = updateCalendarSessionState(next.calendar, result?.artifacts ?? {});
  }
  if (envelope?.agent === "ms.teams") {
    next.teams = updateTeamsSessionState(next.teams, result?.artifacts ?? {});
  }
  return next;
}

export function updateSessionRefsFromReview(sessionRefs, review) {
  const next = { ...(sessionRefs ?? createSessionRefs()) };
  next.review = {
    lastTarget: review?.target ?? null,
    lastItems: Array.isArray(review?.triageItems) ? review.triageItems.slice(0, 10) : []
  };
  next.entities = {
    lastNames: Array.isArray(review?.triageItems)
      ? [...new Set(review.triageItems.flatMap((item) => [item.title]).filter(Boolean))].slice(0, 10)
      : []
  };
  return next;
}

export function resolveOutlookReadParams(envelope, sessionRefs) {
  if (!envelope || envelope.agent !== "ms.outlook" || envelope.action !== "read_email") {
    return envelope;
  }
  const refs = sessionRefs?.outlook ?? {};
  const params = { ...(envelope.params ?? {}) };
  if (!params.id) {
    if (params.reference === "latest" && refs.lastEmailId) {
      params.id = refs.lastEmailId;
    } else if (params.reference === "previous" && refs.lastEmailIds?.[1]) {
      params.id = refs.lastEmailIds[1];
    } else if (refs.lastEmailId) {
      params.id = refs.lastEmailId;
    }
  }
  return { ...envelope, params };
}

function updateCalendarSessionState(state, artifacts) {
  const next = {
    lastEventSubject: state?.lastEventSubject ?? null,
    lastEventLink: state?.lastEventLink ?? null,
    lastTimeRange: state?.lastTimeRange ?? null
  };
  const first = artifacts?.events?.[0];
  if (first) {
    next.lastEventSubject = first.subject ?? next.lastEventSubject;
    next.lastEventLink = first.webLink ?? next.lastEventLink;
  }
  if (artifacts?.timeRange) {
    next.lastTimeRange = artifacts.timeRange;
  }
  return next;
}

function updateTeamsSessionState(state, artifacts) {
  const next = {
    lastThreadId: state?.lastThreadId ?? null,
    lastMessageIds: Array.isArray(state?.lastMessageIds) ? state.lastMessageIds : [],
    lastTeam: state?.lastTeam ?? null,
    lastChannel: state?.lastChannel ?? null
  };
  const rows = [...(artifacts?.hits ?? []), ...(artifacts?.prioritized ?? []), ...(artifacts?.mentions ?? [])];
  const first = rows[0] ?? artifacts?.fallbackMatches?.[0];
  if (first) {
    next.lastThreadId = first.id ?? next.lastThreadId;
    next.lastTeam = first.teamName ?? next.lastTeam;
    next.lastChannel = first.channelName ?? next.lastChannel;
  }
  const ids = rows.map((row) => row.id).filter(Boolean);
  if (ids.length > 0) next.lastMessageIds = ids.slice(0, 10);
  return next;
}
