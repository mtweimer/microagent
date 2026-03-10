import crypto from "node:crypto";
import { translateHeuristic } from "./translator.js";
import {
  ACTION_REGISTRY_VERSION,
  getActionsByDomain,
  getAgentByDomain,
  getDomainConfig
} from "../contracts/actionRegistry.js";
import type { ActionName, DomainName } from "../contracts/actionRegistry.js";
import { validateActionEnvelope } from "./schema.js";
import type { ActionEnvelope, AnyRecord, ModelGatewayLike, TranslationResult } from "./contracts.js";

const CONFIDENCE_CLARIFY_THRESHOLD = 0.65;

interface AuthCheckResult {
  ok: boolean;
}

interface LlmGateway extends ModelGatewayLike {
  checkAuth?: (provider: string) => AuthCheckResult;
}

function asRecord(value: unknown): AnyRecord {
  return typeof value === "object" && value !== null ? (value as AnyRecord) : {};
}

export async function translateRequest(
  input: string,
  domain: DomainName,
  modelGateway: ModelGatewayLike | null
): Promise<TranslationResult> {
  const heuristic = withSchemaVersion(translateHeuristic(input, domain));
  if (!modelGateway) return toResult(heuristic, "heuristic");

  const gateway = modelGateway as LlmGateway;
  const provider = modelGateway.getActiveProvider?.() ?? "none";
  const auth = gateway.checkAuth?.(provider) ?? { ok: true };
  if (!auth.ok && provider !== "ollama") {
    return toResult(heuristic, "heuristic");
  }

  let translated: ActionEnvelope;
  try {
    translated = await attemptLlmTranslation({
      input,
      domain,
      modelGateway,
      correctionErrors: []
    });
  } catch {
    return toResult(heuristic, "heuristic");
  }

  const firstValidation = validateActionEnvelope(translated);
  if (firstValidation.ok && (translated.confidence ?? 0) >= CONFIDENCE_CLARIFY_THRESHOLD) {
    return toResult(translated, "llm", []);
  }

  let corrected: ActionEnvelope;
  try {
    corrected = await attemptLlmTranslation({
      input,
      domain,
      modelGateway,
      correctionErrors: firstValidation.errors
    });
  } catch {
    return toResult(heuristic, "heuristic", firstValidation.errors);
  }
  const secondValidation = validateActionEnvelope(corrected);
  if (secondValidation.ok && (corrected.confidence ?? 0) >= CONFIDENCE_CLARIFY_THRESHOLD) {
    return toResult(corrected, "llm_corrected", []);
  }

  return toResult(heuristic, "heuristic", secondValidation.errors);
}

function withSchemaVersion(envelope: ActionEnvelope): ActionEnvelope {
  return {
    ...envelope,
    schemaVersion: ACTION_REGISTRY_VERSION,
    requestId: envelope.requestId ?? crypto.randomUUID(),
    requiresConfirmation: Boolean(envelope.requiresConfirmation),
    confidence: clampNumber(envelope.confidence, 0.1, 1.0, 0.8)
  };
}

async function attemptLlmTranslation({
  input,
  domain,
  modelGateway,
  correctionErrors
}: {
  input: string;
  domain: DomainName;
  modelGateway: ModelGatewayLike;
  correctionErrors: string[];
}): Promise<ActionEnvelope> {
  const allowedActions = getActionsByDomain(domain);
  const expectedAgent = getAgentByDomain(domain) ?? "dispatcher";
  const domainCfg = getDomainConfig(domain);

  const actionHints = allowedActions
    .map((a) => {
      const hint = domainCfg.actions[a]?.translatorHints ?? "";
      return `${a}: ${hint}`;
    })
    .join("\n");

  const messages = [
    {
      role: "system" as const,
      content:
        "You are an action translator. Return strict JSON only (no markdown). " +
        "Fields: agent, action, params, confidence, requiresConfirmation, schemaVersion."
    },
    {
      role: "user" as const,
      content:
        `Domain: ${domain}\n` +
        `ExpectedAgent: ${expectedAgent}\n` +
        `AllowedActions:\n${actionHints}\n` +
        `SchemaVersion: ${ACTION_REGISTRY_VERSION}\n` +
        `Request: ${input}\n` +
        (correctionErrors.length
          ? `Previous validation errors:\n- ${correctionErrors.join("\n- ")}\n`
          : "")
    }
  ];

  const json = await modelGateway.completeJson(messages);
  return normalizeEnvelope(json, domain, input);
}

function normalizeEnvelope(value: unknown, domain: DomainName, input: string): ActionEnvelope {
  const typed = asRecord(value);
  if (!value || typeof value !== "object") return mkInvalidEnvelope(domain, input);

  const expectedAgent = getAgentByDomain(domain) ?? "dispatcher";
  const allowed = getActionsByDomain(domain);

  let action = String(typed.action ?? "").trim();
  if (action.includes(".")) action = action.split(".").pop() ?? "";
  action = disambiguateAction(domain, action, input);
  if (!allowed.includes(action as ActionName)) return mkInvalidEnvelope(domain, input, action || "invalid_action");

  const params = typeof typed.params === "object" && typed.params !== null ? (typed.params as AnyRecord) : {};

  if (domain === "calendar" && action === "schedule_event") {
    if (!params.title) params.title = input;
    if (!params.when) params.when = input.toLowerCase().includes("tomorrow") ? "tomorrow" : "unspecified";
    if (!Array.isArray(params.attendees)) params.attendees = [];
  }
  if (domain === "calendar" && action === "find_events") {
    if (!params.timeRange) params.timeRange = input.toLowerCase().includes("today") ? "today" : "upcoming";
  }

  if (domain === "outlook" && action === "send_email") {
    if (!Array.isArray(params.to)) params.to = extractEmails(input);
    if (!params.subject) params.subject = "Drafted by dispatcher";
    if (!params.body) params.body = input;
  }
  if (domain === "outlook" && action === "search_email") {
    if (!params.query) params.query = input;
  }
  if (domain === "outlook" && action === "list_recent_emails") {
    if (params.limit === undefined) params.limit = extractTopN(String(input).toLowerCase()) ?? 5;
  }
  if (domain === "outlook" && action === "read_email") {
    if (!params.id && !params.reference) {
      params.reference = "latest";
    }
  }
  if (domain === "teams" && action === "search_messages") {
    const directives = parseTeamsDirectives(input);
    params.query = sanitizeTeamsQuery(params.query, input);
    if (params.top === undefined) params.top = directives.top ?? 30;
    if (!params.surface) params.surface = directives.surface ?? "both";
    if (!params.window) params.window = directives.window ?? "30d";
    if (!params.depth) params.depth = directives.depth ?? "balanced";
    if (!params.team && directives.team) params.team = directives.team;
    if (!params.channel && directives.channel) params.channel = directives.channel;
  }
  if (domain === "teams" && (action === "review_my_day" || action === "search_mentions")) {
    const directives = parseTeamsDirectives(input);
    if (params.top === undefined) params.top = directives.top ?? 30;
    if (!params.surface) params.surface = directives.surface ?? "both";
    if (!params.window) params.window = directives.window ?? "today";
    if (!params.depth) params.depth = directives.depth ?? "balanced";
  }

  return {
    requestId: crypto.randomUUID(),
    schemaVersion: ACTION_REGISTRY_VERSION,
    agent: expectedAgent,
    action: action as ActionName,
    params,
    confidence: clampNumber(typed.confidence, 0.1, 1.0, 0.8),
    requiresConfirmation: Boolean(typed.requiresConfirmation)
  };
}

function disambiguateAction(domain: DomainName, action: string, input: string): string {
  const lower = String(input ?? "").toLowerCase();
  const hasReadVerb = /\bread\b/.test(lower);
  if (domain === "outlook") {
    const emailObject = lower.includes("email") || lower.includes("message") || lower.includes("inbox");
    const implicitEmailRef =
      lower.includes("latest one") ||
      lower.includes("last one") ||
      lower.includes("read it") ||
      lower.includes("that one") ||
      lower.includes("that email");
    const emailTarget = emailObject || implicitEmailRef;
    const readLike = hasReadVerb && emailTarget;
    const retrievalVerb =
      lower.includes("fetch") ||
      lower.includes("get") ||
      lower.includes("retrieve") ||
      lower.includes("list");
    const latestHint = lower.includes("latest") || lower.includes("last") || lower.includes("recent");
    if (isEmailFollowUpQuestion(lower)) {
      return "read_email";
    }
    if (hasReadVerb && implicitEmailRef) {
      return "read_email";
    }
    if (lower.includes("summarize") && emailTarget) {
      return "read_email";
    }
    if (readLike && latestHint) {
      return "read_email";
    }
    if (retrievalVerb && emailTarget && latestHint) {
      return "list_recent_emails";
    }
    if (readLike) return "read_email";
    const searchLike =
      (lower.includes("search") || lower.includes("find") || (retrievalVerb && emailTarget)) &&
      emailTarget;
    const sendLike =
      lower.startsWith("send ") ||
      lower.startsWith("reply ") ||
      lower.includes("send an email") ||
      lower.includes("compose");
    if (searchLike) return "search_email";
    if (sendLike) return "send_email";
  }
  if (domain === "teams") {
    const explicitSearch = lower.includes("search") || lower.includes("find");
    if (lower.includes("mention") || lower.includes("respond")) {
      return "search_mentions";
    }
    if (explicitSearch) {
      return "search_messages";
    }
    if (lower.includes("miss") || lower.includes("today") || lower.includes("review")) {
      return "review_my_day";
    }
  }
  return action;
}

function parseTeamsDirectives(input: string): AnyRecord {
  const lower = String(input ?? "").toLowerCase();
  const out: AnyRecord = {};
  const top = lower.match(/\btop\s*=\s*(\d{1,3})\b/);
  if (top) out.top = Math.max(1, Math.min(100, Number(top[1])));
  const surface = lower.match(/\bsurface\s*=\s*(chats|channels|both)\b/);
  if (surface) out.surface = surface[1];
  const window = lower.match(/\bwindow\s*=\s*(today|48h|7d|30d|all)\b/);
  if (window) out.window = window[1];
  const depth = lower.match(/\bdepth\s*=\s*(fast|balanced|deep)\b/);
  if (depth) out.depth = depth[1];
  const team = lower.match(/\bteam\s*=\s*([^\s]+)/);
  if (team?.[1]) out.team = decodeDirectiveValue(team[1]);
  const channel = lower.match(/\bchannel\s*=\s*([^\s]+)/);
  if (channel?.[1]) out.channel = decodeDirectiveValue(channel[1]);
  return out;
}

function sanitizeTeamsQuery(value: unknown, input: string): string {
  const forced = extractTeamsQueryFromInput(input);
  if (forced) return forced;
  const primary = String(value ?? "").trim();
  const fallback = String(input ?? "").trim();
  let text = primary || fallback;
  text = text.replace(/\b(?:window|surface|depth|top|team|channel)\s*=\s*[^\s]+/gi, " ").replace(/\s+/g, " ").trim();
  text = text.replace(/^search\s+teams\s+for\s+/i, "");
  text = text.replace(/^find\s+teams\s+for\s+/i, "");
  text = text.replace(/^search\s+for\s+/i, "");
  text = text.trim();
  return text || fallback;
}

function extractTeamsQueryFromInput(input: string): string {
  let text = String(input ?? "").trim();
  const original = text;
  text = text.replace(/\b(?:window|surface|depth|top|team|channel)\s*=\s*[^\s]+/gi, " ").replace(/\s+/g, " ").trim();
  const hadPrefix =
    /^search\s+teams\s+for\s+/i.test(text) ||
    /^find\s+teams\s+for\s+/i.test(text) ||
    /^search\s+for\s+/i.test(text);
  text = text.replace(/^search\s+teams\s+for\s+/i, "");
  text = text.replace(/^find\s+teams\s+for\s+/i, "");
  text = text.replace(/^search\s+for\s+/i, "");
  text = text.trim();
  if (hadPrefix && text) return text;
  if (/\b(?:window|surface|depth|top|team|channel)\s*=/.test(original) && text) return text;
  return "";
}

function decodeDirectiveValue(value: string): string {
  return String(value ?? "")
    .replace(/^['"]|['"]$/g, "")
    .replace(/_/g, " ")
    .trim();
}

function extractTopN(lower: string): number | null {
  const m = String(lower ?? "").match(/\b(?:last|latest)\s+(\d{1,2})\b/);
  if (!m) return null;
  const n = Number(m[1]);
  if (Number.isNaN(n) || n < 1) return null;
  return Math.min(50, n);
}

function mkInvalidEnvelope(domain: DomainName, input: string, action = "invalid_action"): ActionEnvelope {
  return {
    requestId: crypto.randomUUID(),
    schemaVersion: ACTION_REGISTRY_VERSION,
    agent: getAgentByDomain(domain) ?? "dispatcher",
    action: action as ActionName,
    params: { input },
    confidence: 0.2,
    requiresConfirmation: true
  };
}

function extractEmails(text: string): string[] {
  const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return [...new Set(matches.map((m) => m.toLowerCase()))];
}

function clampNumber(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function toResult(envelope: ActionEnvelope, source: string, validationErrors: string[] = []): TranslationResult {
  return {
    envelope,
    source,
    validationErrors
  };
}

function isEmailFollowUpQuestion(lower: string): boolean {
  if (!lower.includes("?")) return false;
  return (
    lower.includes("what did they want") ||
    lower.includes("what was it about") ||
    lower.includes("is it important") ||
    lower.includes("was it important") ||
    lower.includes("what did it say")
  );
}
