import { getActionConfig } from "../contracts/actionRegistry.js";
import { assembleChatMessages, assembleComposerMessages } from "./promptAssembler.js";
import { composeWithFallback } from "./composerGateway.js";

export async function composeResponse({
  input,
  actionEnvelope,
  executionResult,
  memoryRefs = [],
  personaContext,
  capabilityPack,
  modelGateway,
  composerConfig = {},
  memoryEvidence = [],
  narrativeEntries = []
}) {
  const isChat = !actionEnvelope;
  const deterministicSuggestions = suggestNextActions(actionEnvelope, executionResult);
  const deterministicText = buildConversationalText({
    input,
    actionEnvelope,
    executionResult,
    suggestedActions: deterministicSuggestions
  });

  if (
    actionEnvelope?.agent === "ms.teams" ||
    (actionEnvelope?.agent === "ms.outlook" && actionEnvelope?.action === "read_email")
  ) {
    return buildDeterministicResponse({
      finalText: deterministicText,
      suggestedActions: deterministicSuggestions,
      executionResult,
      actionEnvelope,
      isChat: false,
      memoryRefs,
      modelGateway,
      source: "template_teams"
    });
  }

  const enabled = composerConfig?.enabled !== false;
  if (!enabled || !modelGateway) {
    return buildDeterministicResponse({
      finalText: deterministicText,
      suggestedActions: deterministicSuggestions,
      executionResult,
      actionEnvelope,
      isChat,
      memoryRefs,
      modelGateway,
      source: "template_disabled"
    });
  }

  if (isChat) {
    const chatText = await composeChatText({
      input,
      modelGateway,
      personaContext,
      capabilityPack,
      memoryEvidence,
      narrativeEntries,
      composerConfig
    });
    return buildDeterministicResponse({
      finalText: chatText || deterministicText,
      suggestedActions: [],
      executionResult,
      actionEnvelope,
      isChat: true,
      memoryRefs,
      modelGateway,
      source: chatText ? "llm_chat" : "template_chat_fallback"
    });
  }

  const messages = assembleComposerMessages({
    input,
    actionEnvelope,
    executionResult,
    personaContext,
    capabilityPack,
    memoryEvidence,
    narrativeEntries,
    budget: composerConfig?.budget ?? {}
  });

  const requestedPrimary = composerConfig?.primary;
  const requestedFallback = composerConfig?.fallback;
  const primary =
    requestedPrimary && requestedPrimary.model !== "active"
      ? requestedPrimary
      : {
          provider: requestedPrimary?.provider ?? modelGateway.getActiveProvider?.(),
          model: modelGateway.getActiveModel?.(requestedPrimary?.provider)
        };
  const fallback =
    requestedFallback && requestedFallback.model !== "active"
      ? requestedFallback
      : requestedFallback
        ? {
            provider: requestedFallback?.provider ?? modelGateway.getActiveProvider?.(),
            model: modelGateway.getActiveModel?.(requestedFallback?.provider)
          }
        : undefined;
  const composed = await composeWithFallback({
    modelGateway,
    messages,
    primary,
    fallback,
    minConfidence: composerConfig?.quality?.minConfidence ?? 0.55,
    retryOnSchemaFail: composerConfig?.quality?.retryOnSchemaFail !== false,
    retryOnLowConfidence: composerConfig?.quality?.retryOnLowConfidence !== false
  });

  if (!composed.ok) {
    return buildDeterministicResponse({
      finalText: deterministicText,
      suggestedActions: deterministicSuggestions,
      executionResult,
      actionEnvelope,
      isChat,
      memoryRefs,
      modelGateway,
      source: "template_fallback",
      errors: composed.errors
    });
  }

  const llmSuggestions = mapComposerSuggestions(
    composed.output.suggestions,
    deterministicSuggestions,
    actionEnvelope,
    executionResult
  );
  const llmEvidence = mapComposerEvidence(composed.output.evidence, actionEnvelope, executionResult);
  const finalText = isChat
    ? [composed.output.summary, composed.output.followUpQuestion ?? ""].join("\n").trim()
    : [
        composed.output.summary,
        composed.output.reasoning ? `\nWhy this matters: ${composed.output.reasoning}` : "",
        composed.output.followUpQuestion ? `\n${composed.output.followUpQuestion}` : ""
      ]
        .join("")
        .trim();

  return {
    finalText,
    conversation: {
      summary: composed.output.summary,
      intent: composed.output.intent,
      reasoning: composed.output.reasoning,
      confidence: composed.output.confidence,
      followUpQuestion: composed.output.followUpQuestion
    },
    evidence: llmEvidence,
    suggestedActions: llmSuggestions,
    conversationMode: isChat ? "chat" : executionResult?.status === "ok" ? "action_result" : "clarify",
    memoryRefs,
    composer: {
      provider: modelGateway?.getActiveProvider?.() ?? "none",
      model: modelGateway?.getActiveModel?.() ?? "none",
      source: `llm_${composed.used}`
    }
  };
}

function buildDeterministicResponse({
  finalText,
  suggestedActions,
  executionResult,
  actionEnvelope,
  isChat = false,
  memoryRefs,
  modelGateway,
  source,
  errors = []
}) {
  const evidence = isChat ? [] : buildDeterministicEvidence(actionEnvelope, executionResult);
  return {
    finalText,
    conversation: {
      summary: finalText,
      intent: executionResult?.status === "ok" ? "assist" : "clarify",
      reasoning: "",
      confidence: 0.5,
      followUpQuestion: null
    },
    evidence,
    suggestedActions,
    conversationMode: isChat ? "chat" : executionResult?.status === "ok" ? "action_result" : "clarify",
    memoryRefs,
    composer: {
      provider: modelGateway?.getActiveProvider?.() ?? "none",
      model: modelGateway?.getActiveModel?.() ?? "none",
      source,
      errors
    }
  };
}

function buildDeterministicEvidence(actionEnvelope, executionResult) {
  if (!actionEnvelope || actionEnvelope.agent !== "ms.teams") return [];
  const artifacts = executionResult?.artifacts ?? {};
  const rows = [...(artifacts.prioritized ?? []), ...(artifacts.mentions ?? []), ...(artifacts.hits ?? [])];
  const uniq = [];
  const seen = new Set();
  for (const row of rows) {
    const id = String(row?.id ?? "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    uniq.push(row);
    if (uniq.length >= 3) break;
  }
  const evidence = uniq.map((row, idx) => {
    const scope =
      row.sourceType === "channel"
        ? `channel:${row.channelName || "unknown"}`
        : `chat:${row.chatTopic || "direct"}`;
    return {
      id: String(row.id ?? `teams-msg-${idx + 1}`),
      type: "teams_message",
      source: "ms.teams",
      label: `${row.from || "unknown"} (${scope})`,
      details: {
        id: row.id ?? null,
        from: row.from ?? null,
        createdDateTime: row.createdDateTime ?? null,
        sourceType: row.sourceType ?? null,
        teamName: row.teamName ?? null,
        channelName: row.channelName ?? null,
        chatTopic: row.chatTopic ?? null,
        webUrl: row.webUrl ?? null,
        why: row.why ?? null,
        snippet: String(row.bodyPreview ?? "").slice(0, 180)
      }
    };
  });

  if (evidence.length === 0 && Array.isArray(artifacts.fallbackMatches) && artifacts.fallbackMatches.length > 0) {
    for (const [idx, match] of artifacts.fallbackMatches.slice(0, 3).entries()) {
      evidence.push({
        id: `teams-workspace-${idx + 1}`,
        type: "teams_workspace_match",
        source: "ms.teams",
        label: String(match.label ?? "workspace match"),
        details: {
          type: match.type ?? null,
          id: match.id ?? null,
          teamName: match.teamName ?? null,
          channelName: match.channelName ?? null,
          webUrl: match.webUrl ?? null,
          score: match.score ?? null,
          why: match.why ?? null
        }
      });
    }
  }

  evidence.push({
    id: "teams-coverage",
    type: "teams_coverage",
    source: "ms.teams",
    label: "Teams scan coverage",
    details: {
      coverage: artifacts.coverage ?? {},
      limitations: Array.isArray(artifacts.limitations) ? artifacts.limitations.slice(0, 5) : []
    }
  });
  return evidence;
}

function buildDeterministicText({ actionEnvelope, executionResult, suggestedActions }) {
  const status = executionResult?.status ?? "ok";
  const message = executionResult?.message ?? "Done.";
  if (!actionEnvelope) return message;

  const header = `Handled ${actionEnvelope.agent}.${actionEnvelope.action}: ${message}`;
  if (suggestedActions.length === 0) return header;
  const lines = suggestedActions.map((s, idx) => `${idx + 1}. ${s.title} (${s.risk})`);
  return `${header}\nSuggested next actions:\n${lines.join("\n")}`;
}

function buildConversationalText({ actionEnvelope, executionResult, suggestedActions }) {
  if (!actionEnvelope) return buildChatFallbackText();
  if (executionResult?.status !== "ok") {
    return `I couldn't complete ${actionEnvelope.agent}.${actionEnvelope.action}: ${executionResult?.message ?? "unknown error"}`;
  }

  if (actionEnvelope.agent === "ms.outlook" && actionEnvelope.action === "search_email") {
    const messages = executionResult?.artifacts?.messages ?? [];
    const top = messages.slice(0, 3);
    const senderCounts = countBy(top.map((m) => m.from).filter(Boolean));
    const topSenders = Object.entries(senderCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([sender, c]) => `${sender}${c > 1 ? ` (${c})` : ""}`);
    const evidence = top
      .map((m) => `- ${m.subject || "(no subject)"} from ${m.from || "unknown"} (${toLocal(m.receivedDateTime)})`)
      .join("\n");
    let text = `I reviewed your email search and found ${messages.length} message(s).`;
    if (topSenders.length > 0) text += ` Top senders in the most relevant results: ${topSenders.join(", ")}.`;
    if (evidence) text += `\nKey messages:\n${evidence}`;
    if (suggestedActions.length > 0) {
      text += `\nI suggested follow-up actions based on these specific messages so you can decide next steps.`;
    }
    return text;
  }

  if (actionEnvelope.agent === "ms.outlook" && actionEnvelope.action === "read_email") {
    const email = executionResult?.artifacts ?? {};
    const advice = assessArtifactIntent(actionEnvelope, email);
    let text = `I opened the email${email.subject ? ` '${email.subject}'` : ""}.`;
    if (email.from) text += `\nFrom: ${email.from}`;
    if (email.receivedDateTime) text += `\nWhen: ${toLocal(email.receivedDateTime)}`;
    if (email.bodyPreview) text += `\nSummary: ${String(email.bodyPreview).slice(0, 240)}`;
    if (advice) {
      text += `\nRecommendation: ${advice.summary}`;
      if (advice.why.length > 0) text += `\nWhy: ${advice.why.join("; ")}`;
    }
    return text;
  }

  if (actionEnvelope.agent === "ms.calendar" && actionEnvelope.action === "find_events") {
    const events = executionResult?.artifacts?.events ?? [];
    const next = events.slice(0, 3);
    const evidence = next
      .map((e) => `- ${e.subject || "(no subject)"} (${toLocal(e.start?.dateTime)} to ${toLocal(e.end?.dateTime)})`)
      .join("\n");
    let text = `I checked your calendar and found ${events.length} event(s) in the requested window.`;
    if (evidence) text += `\nNearest events:\n${evidence}`;
    if (suggestedActions.length > 0) {
      text += `\nI suggested prep/follow-up actions based on timing and meeting load.`;
    }
    return text;
  }

  if (actionEnvelope.agent === "ms.teams") {
    const artifacts = executionResult?.artifacts ?? {};
    const rows =
      artifacts.prioritized ??
      artifacts.mentions ??
      artifacts.hits ??
      (artifacts.id ? [artifacts] : []);
    const coverage = artifacts.coverage ?? {};
    const limitations = Array.isArray(artifacts.limitations) ? artifacts.limitations : [];
    const top = rows.slice(0, 5);
    const bullets = top
      .map((m) => {
        const scope = m.sourceType === "channel" ? `channel:${m.channelName || "unknown"}` : `chat:${m.chatTopic || "direct"}`;
        const why = m.why ? ` [why: ${m.why}]` : "";
        return `- ${m.from || "unknown"} (${toLocal(m.createdDateTime)}, ${scope}): ${(m.bodyPreview || "").slice(0, 120)}${why}`;
      })
      .join("\n");
    const coverageLine =
      `Coverage: chats=${coverage.chatsScanned ?? 0}/${coverage.chatMessagesScanned ?? 0} msgs, ` +
      `channels=${coverage.channelsScanned ?? 0}/${coverage.channelMessagesScanned ?? 0} msgs.`;
    const limitationsLine = limitations.length > 0 ? `\nLimitations: ${limitations.slice(0, 2).join("; ")}` : "";

    if (actionEnvelope.action === "review_my_day") {
      const total = Number(artifacts.total ?? rows.length ?? 0);
      if (total === 0) {
        return (
          "I checked Teams and didn’t find any recent messages in your accessible scope for the selected window. " +
          coverageLine +
          " This can mean no activity, limited visibility, or messages outside the current window. " +
          "Try a keyword search with a project/client term next." +
          limitationsLine
        );
      }
      let text = `I reviewed your recent Teams activity and found ${total} message(s).`;
      if (bullets) text += `\nTop items to triage:\n${bullets}`;
      text += `\n${coverageLine}${limitationsLine}`;
      return text;
    }

    if (actionEnvelope.action === "search_mentions") {
      const total = Number(artifacts.total ?? 0);
      const mentions = Number((artifacts.mentions ?? []).length);
      if (mentions === 0) {
        return `I checked ${total} recent Teams messages and found no clear mention/action items for you.\n${coverageLine}${limitationsLine}`;
      }
      let text = `I found ${mentions} Teams message(s) that look like mentions or direct asks.`;
      if (bullets) text += `\nLikely action-needed:\n${bullets}`;
      text += `\n${coverageLine}${limitationsLine}`;
      return text;
    }

    if (actionEnvelope.action === "search_messages") {
      const query = artifacts.query ?? "";
      const hits = artifacts.hits ?? [];
      const fallbackMatches = artifacts.fallbackMatches ?? [];
      const searchableMatches = Number(artifacts.searchableMatches ?? 0);
      const params = artifacts.params ?? {};
      const hasScope = Boolean(params.team || params.channel);
      const maxScan = params.window === "all" && params.depth === "deep" && Number(params.top ?? 0) >= 100;
      if (hits.length === 0) {
        let text = `I searched Teams for '${query}' and found no matches in the selected scope/window.`;
        if (fallbackMatches.length > 0) {
          const sample = fallbackMatches
            .slice(0, 3)
            .map((m) => (m.type === "channel" ? `${m.teamName} / ${m.channelName}` : m.label))
            .filter(Boolean)
            .join("; ");
          if (sample) {
            text += ` I did find matching workspace names: ${sample}.`;
          }
        }
        if (searchableMatches === 0 && params.window !== "all") {
          text += " Try broadening to `window=all` or searching by team/channel name.";
        } else if (searchableMatches === 0 && !maxScan) {
          text += " Try increasing `top` and `depth=deep`, or search by team/channel name.";
        } else if (searchableMatches === 0 && maxScan) {
          text += hasScope
            ? " You are already at max scan settings with scope applied; try relaxing scope or changing query terms."
            : " You are already at max scan settings; try a team/channel-scoped search.";
        }
        if (params.window === "today") {
          text += " This may be due to a narrow time window.";
        }
        return `${text}\n${coverageLine}${limitationsLine}`;
      }
      let text = `I found ${hits.length} Teams message(s) for '${query}'.`;
      if (bullets) text += `\nBest matches:\n${bullets}`;
      text += `\n${coverageLine}${limitationsLine}`;
      return text;
    }

    if (actionEnvelope.action === "read_message") {
      const message = artifacts;
      const advice = assessArtifactIntent(actionEnvelope, message);
      const scope = message.sourceType === "channel"
        ? `channel:${message.channelName || "unknown"}`
        : `chat:${message.chatTopic || "direct"}`;
      let text = `I pulled the Teams message from ${scope}.`;
      if (message.from) text += `\nFrom: ${message.from}`;
      if (message.createdDateTime) text += `\nWhen: ${toLocal(message.createdDateTime)}`;
      if (message.teamName) text += `\nTeam: ${message.teamName}`;
      if (message.bodyPreview) text += `\nMessage: ${String(message.bodyPreview).slice(0, 280)}`;
      if (advice) {
        text += `\nRecommendation: ${advice.summary}`;
        if (advice.why.length > 0) text += `\nWhy: ${advice.why.join("; ")}`;
      }
      return text;
    }
  }

  return buildDeterministicText({ actionEnvelope, executionResult, suggestedActions });
}

function buildChatFallbackText() {
  return "I’m micro-claw. I can help with Outlook and Calendar workflows, memory recall, and planning. What should we work on?";
}

function suggestNextActions(actionEnvelope, executionResult) {
  if (!actionEnvelope || executionResult?.status !== "ok") return [];
  const suggestions = [];

  if (actionEnvelope.agent === "ms.outlook" && actionEnvelope.action === "search_email") {
    const messages = executionResult?.artifacts?.messages ?? [];
    const topMessages = messages.slice(0, 3).map((m) => ({
      subject: m.subject ?? "(no subject)",
      from: m.from ?? "unknown",
      receivedDateTime: m.receivedDateTime ?? null
    }));
    suggestions.push({
      id: "outlook-s1",
      title: "Draft a follow-up email",
      rationale: "Potential response-needed messages were found in your search results.",
      risk: "high",
      evidence: topMessages,
      actionEnvelope: {
        agent: "ms.outlook",
        action: "send_email",
        params: { to: [], subject: "Follow-up", body: "Drafted follow-up." }
      }
    });
    suggestions.push({
      id: "outlook-s2",
      title: "Create a calendar follow-up block",
      rationale: "You may want dedicated time to respond to or process the highest-priority messages.",
      risk: "medium",
      evidence: topMessages,
      actionEnvelope: {
        agent: "ms.calendar",
        action: "schedule_event",
        params: { title: "Email follow-up", when: "tomorrow", attendees: [] }
      }
    });
  }

  if (actionEnvelope.agent === "ms.calendar" && actionEnvelope.action === "find_events") {
    const events = executionResult?.artifacts?.events ?? [];
    const nextEvent = events[0]
      ? {
          subject: events[0].subject ?? "(no subject)",
          start: events[0].start?.dateTime ?? null,
          end: events[0].end?.dateTime ?? null,
          webLink: events[0].webLink ?? null,
          isOnlineMeeting: Boolean(events[0].isOnlineMeeting),
          onlineMeetingUrl: events[0].onlineMeetingUrl ?? null,
          location: events[0].location ?? null,
          durationMinutes: durationMinutes(events[0].start?.dateTime, events[0].end?.dateTime)
        }
      : null;
    suggestions.push({
      id: "calendar-s1",
      title: "Schedule prep time for key meeting",
      rationale: "A nearby meeting exists and prep time can reduce context switching.",
      risk: "medium",
      evidence: nextEvent ? [nextEvent] : [],
      actionEnvelope: {
        agent: "ms.calendar",
        action: "schedule_event",
        params: { title: "Meeting prep", when: "today", attendees: [] }
      }
    });
  }

  if (actionEnvelope.agent === "ms.teams" && actionEnvelope.action === "review_my_day") {
    const rows = executionResult?.artifacts?.prioritized ?? [];
    const hasChannelCoverage = Number(executionResult?.artifacts?.coverage?.channelsScanned ?? 0) > 0;
    if (rows.length > 0) {
      suggestions.push({
        id: "teams-s1",
        title: "Find direct mentions",
        rationale: "Narrow broad activity into direct asks that likely need a response.",
        risk: "low",
        evidence: rows.slice(0, 3),
        actionEnvelope: {
          agent: "ms.teams",
          action: "search_mentions",
          params: { top: 40, surface: "both", window: "today", depth: "deep" }
        }
      });
      suggestions.push({
        id: "teams-s2",
        title: "Block response time",
        rationale: "Set aside focused time to respond to Teams follow-ups.",
        risk: "medium",
        evidence: rows.slice(0, 2),
        actionEnvelope: {
          agent: "ms.calendar",
          action: "schedule_event",
          params: { title: "Respond to Teams threads", when: "today", attendees: [] }
        }
      });
    } else {
      suggestions.push({
        id: "teams-s3",
        title: "Search Teams by keyword",
        rationale: "Target a project/client name when broad review has no hits.",
        risk: "low",
        evidence: [],
        actionEnvelope: {
          agent: "ms.teams",
          action: "search_messages",
          params: {
            query: "project",
            top: 30,
            surface: hasChannelCoverage ? "both" : "chats",
            window: "30d",
            depth: "balanced"
          }
        }
      });
    }
  }

  if (actionEnvelope.agent === "ms.teams" && actionEnvelope.action === "search_mentions") {
    const mentions = executionResult?.artifacts?.mentions ?? [];
    if (mentions.length > 0) {
      suggestions.push({
        id: "teams-s4",
        title: "Block reply time for mentions",
        rationale: "Convert likely mention/action items into scheduled response time.",
        risk: "medium",
        evidence: mentions.slice(0, 2),
        actionEnvelope: {
          agent: "ms.calendar",
          action: "schedule_event",
          params: { title: "Reply to Teams mentions", when: "today", attendees: [] }
        }
      });
    }
  }

  if (actionEnvelope.agent === "ms.teams" && actionEnvelope.action === "search_messages") {
    const hits = executionResult?.artifacts?.hits ?? [];
    const fallbackMatches = executionResult?.artifacts?.fallbackMatches ?? [];
    const query = executionResult?.artifacts?.query ?? "project";
    const params = executionResult?.artifacts?.params ?? {};
    const window = params.window ?? "30d";
    const depth = params.depth ?? "balanced";
    const top = Number(params.top ?? 30);
    const surface = params.surface ?? "both";
    const hasScope = Boolean(params.team || params.channel);
    const maxScan = window === "all" && depth === "deep" && top >= 100;
    if (hits.length === 0) {
      if (fallbackMatches.length > 0) {
        const first = fallbackMatches[0];
        let nextQuery =
          first.type === "channel" && first.channelName
            ? first.channelName
            : first.label || query;
        const scoped = {};
        let nextSurface = surface;
        if (first.type === "channel") {
          if (first.teamName) scoped.team = first.teamName;
          if (first.channelName) scoped.channel = first.channelName;
        } else if (first.type === "team" && first.label) {
          scoped.team = first.label;
        } else if (first.type === "chat" && first.label) {
          // For chat fallback, keep the user's keyword query and use chat title as scope.
          nextQuery = query;
          scoped.team = first.label;
          nextSurface = "chats";
        }
        suggestions.push({
          id: "teams-s8",
          title: "Search within matched workspace",
          rationale: "No message-body hits yet, but similar team/channel names were found.",
          risk: "low",
          evidence: fallbackMatches.slice(0, 3),
          actionEnvelope: {
            agent: "ms.teams",
            action: "search_messages",
            params: {
              query: nextQuery,
              top: Math.max(50, top),
              surface: nextSurface,
              window: "all",
              depth: "deep",
              ...scoped
            }
          }
        });
      }
      if (window !== "all") {
        suggestions.push({
          id: "teams-s5",
          title: "Retry with broader window",
          rationale: "No hits in the current scope/window; widening time range can surface older relevant threads.",
          risk: "low",
          evidence: [],
          actionEnvelope: {
            agent: "ms.teams",
            action: "search_messages",
            params: { query, top: Math.max(30, top), surface, window: "all", depth: "balanced" }
          }
        });
      } else if (!maxScan && (depth !== "deep" || top < 80)) {
        suggestions.push({
          id: "teams-s6",
          title: "Increase scan depth",
          rationale: "No hits found; scanning deeper and with a larger top can improve recall.",
          risk: "low",
          evidence: [],
          actionEnvelope: {
            agent: "ms.teams",
            action: "search_messages",
            params: { query, top: Math.max(80, top), surface, window: "all", depth: "deep" }
          }
        });
      } else {
        if (hasScope) {
          suggestions.push({
            id: "teams-s9",
            title: "Relax scope and retry",
            rationale: "Scoped search produced no hits at max scan; broaden scope while keeping deep scan.",
            risk: "low",
            evidence: [],
            actionEnvelope: {
              agent: "ms.teams",
              action: "search_messages",
              params: { query, top, surface, window: "all", depth: "deep" }
            }
          });
        } else {
          suggestions.push({
            id: "teams-s7",
            title: "Search by team/channel name",
            rationale: "Message-body search produced no hits; try workspace names or sender-focused terms.",
            risk: "low",
            evidence: [],
            actionEnvelope: {
              agent: "ms.teams",
              action: "search_messages",
              params: { query: "hoplite", top: top, surface, window: "all", depth: "deep" }
            }
          });
        }
      }
    }
  }

  if (actionEnvelope.agent === "ms.teams" && actionEnvelope.action === "read_message") {
    const message = executionResult?.artifacts ?? {};
    suggestions.push({
      id: "teams-read-s1",
      title: "Search this workspace for more context",
      rationale: "Use the message's team or channel to pull more surrounding context.",
      risk: "low",
      evidence: [message],
      actionEnvelope: {
        agent: "ms.teams",
        action: "search_messages",
        params: {
          query: message.teamName || message.channelName || message.from || "project",
          top: 20,
          surface: message.sourceType === "channel" ? "channels" : "chats",
          window: "30d",
          depth: "deep",
          ...(message.teamName ? { team: message.teamName } : {}),
          ...(message.channelName ? { channel: message.channelName } : {})
        }
      }
    });
  }

  return suggestions.map((s) => ({ ...s, safe: isSuggestionSafe(s) }));
}

function isSuggestionSafe(suggestion) {
  const cfg = getActionConfig(suggestion.actionEnvelope.agent, suggestion.actionEnvelope.action);
  return cfg?.executorCapabilities?.dryRun === true;
}

function toLocal(value) {
  if (!value) return "unknown time";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

function countBy(values) {
  const out = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

function durationMinutes(start, end) {
  const s = new Date(start ?? 0).getTime();
  const e = new Date(end ?? 0).getTime();
  if (!s || !e || Number.isNaN(s) || Number.isNaN(e) || e <= s) return null;
  return Math.round((e - s) / 60000);
}

function assessArtifactIntent(actionEnvelope, artifact) {
  if (!artifact || typeof artifact !== "object") return null;
  const text = `${artifact.subject ?? ""} ${artifact.bodyPreview ?? ""} ${artifact.summary ?? ""}`.toLowerCase();
  const from = String(artifact.from ?? "").toLowerCase();
  let score = 0;
  const why = [];
  if (/\?|please|review|need|action|follow up|reply|respond|urgent|approve/.test(text)) {
    score += 2;
    why.push("contains direct action or response language");
  }
  if (/fwd:|fw:|follow up|reply needed|next steps/.test(text)) {
    score += 1;
    why.push("looks like an active thread");
  }
  if (from.includes("noreply") || from.includes("notification") || from.includes("workflows")) {
    score -= 2;
    why.push("sender looks automated");
  } else if (from) {
    score += 1;
    why.push("sender appears human");
  }
  if (score >= 3) {
    return {
      summary: "likely worth a response or at least a quick review before you move on.",
      why
    };
  }
  if (score <= -1) {
    return {
      summary: "likely informational noise unless this sender or topic is currently important to you.",
      why
    };
  }
  return {
    summary: "looks informational; review it if this topic is active, but it does not strongly signal urgent follow-up.",
    why
  };
}

async function composeChatText({
  input,
  modelGateway,
  personaContext,
  capabilityPack,
  memoryEvidence,
  narrativeEntries,
  composerConfig
}) {
  try {
    const requestedPrimary = composerConfig?.primary;
    const provider = requestedPrimary?.provider ?? modelGateway.getActiveProvider?.();
    const model =
      requestedPrimary && requestedPrimary.model !== "active"
        ? requestedPrimary.model
        : modelGateway.getActiveModel?.(provider);
    const messages = assembleChatMessages({
      input,
      personaContext,
      capabilityPack,
      memoryEvidence,
      narrativeEntries,
      budget: composerConfig?.budget ?? {}
    });
    const text = (await modelGateway.completeText(messages, { provider, model })).trim();
    if (!text) return null;
    if (isSchemaLike(text)) return null;
    return text;
  } catch {
    return null;
  }
}

function isSchemaLike(text) {
  const lower = String(text ?? "").toLowerCase();
  if (lower.startsWith("{") || lower.startsWith("[")) return true;
  return (
    lower.includes("why this matters:") ||
    lower.includes("\"summary\"") ||
    lower.includes("\"suggestions\"") ||
    lower.includes("general conversation mode activated")
  );
}

function mapComposerSuggestions(llmSuggestions, deterministicSuggestions, actionEnvelope, executionResult) {
  if (!Array.isArray(llmSuggestions) || llmSuggestions.length === 0) return deterministicSuggestions;
  const byId = new Map(deterministicSuggestions.map((s) => [s.id, s]));
  const mapped = [];
  for (const s of llmSuggestions) {
    if (!s || typeof s !== "object") continue;
    const id = String(s.id ?? "");
    const fromDet = byId.get(id);
    const actionEnvelopeValue = normalizeComposerActionEnvelope(
      s.actionEnvelope,
      fromDet?.actionEnvelope,
      actionEnvelope,
      executionResult
    );
    mapped.push({
      id: id || fromDet?.id || `s${mapped.length + 1}`,
      title: String(s.title ?? fromDet?.title ?? "Suggested action"),
      rationale: String(s.why ?? fromDet?.rationale ?? ""),
      risk: normalizeRisk(String(s.risk ?? fromDet?.risk ?? "medium")),
      safe: fromDet?.safe ?? false,
      evidence: fromDet?.evidence ?? [],
      evidenceRefs: Array.isArray(s.evidenceRefs) ? s.evidenceRefs.map(String) : [],
      actionEnvelope: actionEnvelopeValue
    });
  }
  return mapped.length > 0 ? mapped : deterministicSuggestions;
}

function mapComposerEvidence(llmEvidence, actionEnvelope, executionResult) {
  if (!Array.isArray(llmEvidence)) return [];
  const mapped = [];
  for (const e of llmEvidence) {
    if (!e || typeof e !== "object") continue;
    mapped.push({
      id: String(e.id ?? `e${mapped.length + 1}`),
      type: String(e.type ?? "artifact"),
      source: String(e.source ?? actionEnvelope?.agent ?? "unknown"),
      label: String(e.label ?? "Evidence"),
      details: typeof e.details === "object" && e.details !== null ? e.details : {}
    });
  }
  if (mapped.length > 0) return mapped;
  const result = executionResult?.artifacts ?? {};
  return [
    {
      id: "e1",
      type: "action_result",
      source: actionEnvelope?.agent ?? "unknown",
      label: `${actionEnvelope?.agent ?? "agent"}.${actionEnvelope?.action ?? "action"}`,
      details: result
    }
  ];
}

function normalizeComposerActionEnvelope(value, fallback, parentActionEnvelope, executionResult) {
  if (value && typeof value === "object" && typeof value.agent === "string" && typeof value.action === "string") {
    return {
      agent: value.agent,
      action: value.action,
      params: typeof value.params === "object" && value.params !== null ? value.params : {}
    };
  }
  if (fallback) return fallback;
  if (parentActionEnvelope?.agent === "ms.outlook") {
    return {
      agent: "ms.outlook",
      action: "send_email",
      params: { to: [], subject: "Follow-up", body: executionResult?.message ?? "Follow-up." }
    };
  }
  return {
    agent: "ms.calendar",
    action: "schedule_event",
    params: { title: "Follow-up", when: "tomorrow", attendees: [] }
  };
}

function normalizeRisk(risk) {
  const lower = String(risk ?? "").toLowerCase();
  if (lower === "low" || lower === "medium" || lower === "high") return lower;
  return "medium";
}
