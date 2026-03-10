// @ts-nocheck
import { detectDomain } from "../../contracts/actionRegistry.js";

export function inferContextualDomain(input, sessionRefs) {
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

export function resolveDomain(input, selection, sessionRefs) {
  const primary = selection?.primary ?? detectDomain(input);
  if (primary) return primary;
  return inferContextualDomain(input, sessionRefs);
}
