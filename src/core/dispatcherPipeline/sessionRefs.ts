import {
  createOutlookSessionState,
  updateOutlookSessionState
} from "../../agents/outlook/memory/sessionState.js";
import type {
  ActionEnvelope,
  AnyRecord,
  AgentExecutionResult,
  CalendarSessionRefs,
  DispatcherResponse,
  SessionRefs,
  TeamsSessionRefs,
  TriageItem
} from "../contracts.js";

type OutlookSessionState = ReturnType<typeof createOutlookSessionState>;

interface ReviewUpdate {
  target?: string | null;
  triageItems?: TriageItem[];
}

function asRecord(value: unknown): AnyRecord {
  return typeof value === "object" && value !== null ? (value as AnyRecord) : {};
}

function asRows(value: unknown): AnyRecord[] {
  return Array.isArray(value)
    ? value.filter((row): row is AnyRecord => typeof row === "object" && row !== null)
    : [];
}

export function createSessionRefs(): SessionRefs {
  return {
    outlook: createOutlookSessionState() as OutlookSessionState,
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

export function updateSessionRefsFromCached(
  sessionRefs: SessionRefs | null | undefined,
  cachedResponse: DispatcherResponse
): SessionRefs {
  const next = { ...(sessionRefs ?? createSessionRefs()) };
  const cachedAction = cachedResponse.artifacts?.action;
  if (cachedAction?.agent === "ms.outlook") {
    next.outlook = updateOutlookSessionState(
      next.outlook,
      { artifacts: cachedResponse.artifacts?.result ?? {} },
      cachedAction.action
    ) as OutlookSessionState;
  }
  if (cachedAction?.agent === "ms.calendar") {
    next.calendar = updateCalendarSessionState(next.calendar, cachedResponse.artifacts?.result ?? {});
  }
  if (cachedAction?.agent === "ms.teams") {
    next.teams = updateTeamsSessionState(next.teams, cachedResponse.artifacts?.result ?? {});
  }
  return next;
}

export function updateSessionRefsFromExecution(
  sessionRefs: SessionRefs | null | undefined,
  envelope: ActionEnvelope,
  result: AgentExecutionResult
): SessionRefs {
  const next = { ...(sessionRefs ?? createSessionRefs()) };
  if (envelope.agent === "ms.outlook") {
    next.outlook = updateOutlookSessionState(next.outlook, result, envelope.action) as OutlookSessionState;
  }
  if (envelope.agent === "ms.calendar") {
    next.calendar = updateCalendarSessionState(next.calendar, asRecord(result.artifacts));
  }
  if (envelope.agent === "ms.teams") {
    next.teams = updateTeamsSessionState(next.teams, asRecord(result.artifacts));
  }
  return next;
}

export function updateSessionRefsFromReview(
  sessionRefs: SessionRefs | null | undefined,
  review: ReviewUpdate
): SessionRefs {
  const next = { ...(sessionRefs ?? createSessionRefs()) };
  const triageItems = Array.isArray(review?.triageItems) ? review.triageItems.slice(0, 10) : [];
  next.review = {
    lastTarget: review?.target ?? null,
    lastItems: triageItems
  };
  next.entities = {
    lastNames: [...new Set(triageItems.map((item) => item.title).filter(Boolean))].slice(0, 10)
  };
  return next;
}

export function resolveOutlookReadParams(
  envelope: ActionEnvelope | null | undefined,
  sessionRefs: SessionRefs | null | undefined
): ActionEnvelope | null | undefined {
  if (!envelope || envelope.agent !== "ms.outlook" || envelope.action !== "read_email") {
    return envelope;
  }
  const refs = sessionRefs?.outlook ?? createOutlookSessionState();
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

function updateCalendarSessionState(state: CalendarSessionRefs, artifacts: AnyRecord): CalendarSessionRefs {
  const next: CalendarSessionRefs = {
    lastEventSubject: state?.lastEventSubject ?? null,
    lastEventLink: state?.lastEventLink ?? null,
    lastTimeRange: state?.lastTimeRange ?? null
  };
  const first = asRows(artifacts.events)[0];
  if (first) {
    next.lastEventSubject = typeof first.subject === "string" ? first.subject : next.lastEventSubject;
    next.lastEventLink = typeof first.webLink === "string" ? first.webLink : next.lastEventLink;
  }
  if (typeof artifacts.timeRange === "string") {
    next.lastTimeRange = artifacts.timeRange;
  }
  return next;
}

function updateTeamsSessionState(state: TeamsSessionRefs, artifacts: AnyRecord): TeamsSessionRefs {
  const next: TeamsSessionRefs = {
    lastThreadId: state?.lastThreadId ?? null,
    lastMessageIds: Array.isArray(state?.lastMessageIds) ? state.lastMessageIds : [],
    lastTeam: state?.lastTeam ?? null,
    lastChannel: state?.lastChannel ?? null
  };
  const rows = [
    ...asRows(artifacts.hits),
    ...asRows(artifacts.prioritized),
    ...asRows(artifacts.mentions)
  ];
  const first = rows[0] ?? asRows(artifacts.fallbackMatches)[0];
  if (first) {
    next.lastThreadId = typeof first.id === "string" ? first.id : next.lastThreadId;
    next.lastTeam = typeof first.teamName === "string" ? first.teamName : next.lastTeam;
    next.lastChannel = typeof first.channelName === "string" ? first.channelName : next.lastChannel;
  }
  const ids = rows
    .map((row) => row.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  if (ids.length > 0) next.lastMessageIds = ids.slice(0, 10);
  return next;
}
