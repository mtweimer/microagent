import { getRegistryVersion } from "./schema.js";

function isEmailFollowup(input) {
  const text = String(input ?? "").toLowerCase();
  return [
    "what did they want",
    "what was that email about",
    "summarize it",
    "could you summarize it",
    "is it important",
    "is that important",
    "should i respond",
    "read it",
    "read that"
  ].some((p) => text.includes(p));
}

function isCalendarFollowup(input) {
  return /\b(that|this)\s+(meeting|event)\b/i.test(String(input ?? ""));
}

function isReviewFollowup(input) {
  const text = String(input ?? "").toLowerCase();
  return [
    "is that important",
    "should i respond",
    "should i reply",
    "what was that from",
    "what thread was that",
    "tell me more about that"
  ].some((p) => text.includes(p));
}

export function resolveFollowupInput(input, sessionRefs) {
  const nowId = `followup-${Date.now()}`;
  if (isEmailFollowup(input) && sessionRefs?.outlook?.lastEmailId) {
    return {
      source: "followup",
      envelope: {
        requestId: nowId,
        schemaVersion: getRegistryVersion(),
        agent: "ms.outlook",
        action: "read_email",
        params: {
          id: sessionRefs.outlook.lastEmailId
        },
        confidence: 0.98,
        requiresConfirmation: false
      }
    };
  }
  if (isReviewFollowup(input)) {
    const item = sessionRefs?.review?.lastItems?.[0];
    if (item?.sourceDomain === "outlook" && item?.sourceArtifactId) {
      return {
        source: "review_followup",
        envelope: {
          requestId: nowId,
          schemaVersion: getRegistryVersion(),
          agent: "ms.outlook",
          action: "read_email",
          params: {
            id: item.sourceArtifactId
          },
          confidence: 0.97,
          requiresConfirmation: false
        }
      };
    }
    if (item?.sourceDomain === "teams" && item?.sourceArtifactId) {
      return {
        source: "review_followup",
        envelope: {
          requestId: nowId,
          schemaVersion: getRegistryVersion(),
          agent: "ms.teams",
          action: "read_message",
          params: {
            id: item.sourceArtifactId
          },
          confidence: 0.95,
          requiresConfirmation: false
        }
      };
    }
    if (item?.sourceDomain === "calendar") {
      return {
        source: "review_followup",
        envelope: {
          requestId: nowId,
          schemaVersion: getRegistryVersion(),
          agent: "ms.calendar",
          action: "find_events",
          params: {
            timeRange: sessionRefs?.calendar?.lastTimeRange ?? "today"
          },
          confidence: 0.82,
          requiresConfirmation: false
        }
      };
    }
  }
  if (isCalendarFollowup(input) && sessionRefs?.calendar?.lastEventSubject) {
    return {
      source: "followup",
      envelope: {
        requestId: nowId,
        schemaVersion: getRegistryVersion(),
        agent: "ms.calendar",
        action: "find_events",
        params: {
          timeRange: sessionRefs.calendar.lastTimeRange ?? "today"
        },
        confidence: 0.85,
        requiresConfirmation: false
      }
    };
  }
  return null;
}
