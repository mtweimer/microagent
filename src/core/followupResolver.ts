import { getRegistryVersion } from "./schema.js";
import type { ActionEnvelope, FollowupResolution, SessionRefs } from "./contracts.js";

function buildEnvelope(agent: string, action: string, params: Record<string, unknown>, confidence: number): ActionEnvelope {
  return {
    requestId: `followup-${Date.now()}`,
    schemaVersion: getRegistryVersion(),
    agent,
    action,
    params,
    confidence,
    requiresConfirmation: false
  };
}

function isEmailFollowup(input: string): boolean {
  const text = String(input ?? "").toLowerCase();
  return [
    "what did they want",
    "what did",
    "what was that email about",
    "summarize it",
    "could you summarize it",
    "is it important",
    "is that important",
    "should i respond",
    "read it",
    "read that"
  ].some((pattern) => text.includes(pattern));
}

function extractEntityHints(input: string): string[] {
  const matches = [
    ...(String(input ?? "").match(/\b[A-Z]{2,}\b/g) ?? []),
    ...(String(input ?? "").match(/[A-Z][A-Za-z0-9&<>_-]+(?:\s+[A-Z][A-Za-z0-9&<>_-]+){0,3}/g) ?? [])
  ];
  return [...new Set(matches.map((value) => value.trim()).filter(Boolean))];
}

function itemMatchesHints(item: SessionRefs["review"]["lastItems"][number], hints: string[], fallbackTarget: string | null): boolean {
  if (hints.length === 0) return Boolean(fallbackTarget);
  const haystack = `${item.title} ${item.rationale} ${JSON.stringify(item.evidence ?? [])}`.toLowerCase();
  return hints.some((hint) => haystack.includes(hint.toLowerCase()) || fallbackTarget?.toLowerCase() === hint.toLowerCase());
}

function buildArtifactFollowup(item: SessionRefs["review"]["lastItems"][number], sessionRefs: SessionRefs): FollowupResolution | null {
  if (item.sourceDomain === "outlook" && item.sourceArtifactId) {
    return {
      source: "review_followup",
      envelope: buildEnvelope("ms.outlook", "read_email", { id: item.sourceArtifactId }, 0.97)
    };
  }
  if (item.sourceDomain === "teams" && item.sourceArtifactId) {
    return {
      source: "review_followup",
      envelope: buildEnvelope("ms.teams", "read_message", { id: item.sourceArtifactId }, 0.95)
    };
  }
  if (item.sourceDomain === "calendar") {
    return {
      source: "review_followup",
      envelope: buildEnvelope(
        "ms.calendar",
        "find_events",
        { timeRange: sessionRefs?.calendar?.lastTimeRange ?? "today" },
        0.82
      )
    };
  }
  return null;
}

function isCalendarFollowup(input: string): boolean {
  return /\b(that|this)\s+(meeting|event)\b/i.test(String(input ?? ""));
}

function isReviewFollowup(input: string): boolean {
  const text = String(input ?? "").toLowerCase();
  return [
    "is that important",
    "should i respond",
    "should i reply",
    "what was that from",
    "what thread was that",
    "tell me more about that"
  ].some((pattern) => text.includes(pattern));
}

export function resolveFollowupInput(
  input: string,
  sessionRefs: SessionRefs | null | undefined
): FollowupResolution | null {
  const hints = extractEntityHints(input);
  const latestReviewItem = sessionRefs?.review?.lastItems?.[0];
  const matchingReviewItem = sessionRefs?.review?.lastItems?.find((item) =>
    itemMatchesHints(item, hints, sessionRefs?.review?.lastTarget ?? null)
  );

  if (/\b(latest one|latest|that one|what about the latest one)\b/i.test(String(input ?? ""))) {
    if (sessionRefs?.teams?.lastMessageIds?.[0]) {
      return {
        source: "followup_latest",
        envelope: buildEnvelope("ms.teams", "read_message", { id: sessionRefs.teams.lastMessageIds[0] }, 0.95)
      };
    }
    if (sessionRefs?.outlook?.lastEmailId) {
      return {
        source: "followup_latest",
        envelope: buildEnvelope("ms.outlook", "read_email", { id: sessionRefs.outlook.lastEmailId }, 0.95)
      };
    }
  }

  if (matchingReviewItem) {
    const out = buildArtifactFollowup(matchingReviewItem, sessionRefs ?? ({} as SessionRefs));
    if (out) return out;
  }

  if (isEmailFollowup(input) && sessionRefs?.outlook?.lastEmailId) {
    return {
      source: "followup",
      envelope: buildEnvelope("ms.outlook", "read_email", { id: sessionRefs.outlook.lastEmailId }, 0.98)
    };
  }

  if (isReviewFollowup(input)) {
    const out = latestReviewItem ? buildArtifactFollowup(latestReviewItem, sessionRefs ?? ({} as SessionRefs)) : null;
    if (out) return out;
  }

  if (isCalendarFollowup(input) && sessionRefs?.calendar?.lastEventSubject) {
    return {
      source: "followup",
      envelope: buildEnvelope(
        "ms.calendar",
        "find_events",
        { timeRange: sessionRefs.calendar.lastTimeRange ?? "today" },
        0.85
      )
    };
  }

  return null;
}
