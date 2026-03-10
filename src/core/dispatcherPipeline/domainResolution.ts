import { detectDomain } from "../../contracts/actionRegistry.js";
import type { DomainSelection, SessionRefs } from "../contracts.js";

export function inferContextualDomain(input: string, sessionRefs: SessionRefs | null | undefined): string | null {
  const lower = String(input ?? "").toLowerCase();
  const hasOutlookRef = Boolean(sessionRefs?.outlook?.lastEmailId);
  if (!hasOutlookRef) return null;
  if (
    lower.includes("latest one") ||
    lower.includes("last one") ||
    lower.includes("read it") ||
    lower.includes("that email") ||
    lower.includes("the email") ||
    lower.includes("summarize it") ||
    (lower.includes("summarize") && lower.includes("email")) ||
    lower.includes("what did they want") ||
    lower.includes("what was it about") ||
    lower.includes("what did it say") ||
    lower.includes("is it important") ||
    lower.includes("was it important")
  ) {
    return "outlook";
  }
  return null;
}

export function resolveDomain(input: string, selection: DomainSelection | null | undefined, sessionRefs: SessionRefs | null | undefined): string | null {
  const primary = selection?.primary ?? detectDomain(input);
  if (primary) return primary;
  return inferContextualDomain(input, sessionRefs);
}
