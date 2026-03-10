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
  if (isEmailFollowup(input) && sessionRefs?.outlook?.lastEmailId) {
    return {
      source: "followup",
      envelope: buildEnvelope("ms.outlook", "read_email", { id: sessionRefs.outlook.lastEmailId }, 0.98)
    };
  }

  if (isReviewFollowup(input)) {
    const item = sessionRefs?.review?.lastItems?.[0];
    if (item?.sourceDomain === "outlook" && item.sourceArtifactId) {
      return {
        source: "review_followup",
        envelope: buildEnvelope("ms.outlook", "read_email", { id: item.sourceArtifactId }, 0.97)
      };
    }
    if (item?.sourceDomain === "teams" && item.sourceArtifactId) {
      return {
        source: "review_followup",
        envelope: buildEnvelope("ms.teams", "read_message", { id: item.sourceArtifactId }, 0.95)
      };
    }
    if (item?.sourceDomain === "calendar") {
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
