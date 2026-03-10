function normalizeText(value) {
  return String(value ?? "").toLowerCase();
}

function tokenize(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function classifyPriority(score) {
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  return "low";
}

function classifyEmail(message, context = {}) {
  const subject = normalizeText(message.subject);
  const from = normalizeText(message.from);
  let score = 4;
  const reasons = [];
  if (/reply|fw:|fwd:|follow up|action|review|approve|urgent/.test(subject)) {
    score += 2;
    reasons.push("subject suggests action or follow-up");
  }
  if (from.includes("workflows") || from.includes("notification") || from.includes("noreply")) {
    score -= 2;
    reasons.push("sender looks automated");
  } else {
    score += 1;
    reasons.push("message is from a human sender");
  }
  const overlap = sharedContextOverlap(subject, context);
  if (overlap > 0) {
    score += Math.min(2, overlap);
    reasons.push("aligned with current meeting/client context");
  }
  return {
    triageClass: score <= 2 ? "automation_noise" : score >= 6 ? "needs_response" : "important_fyi",
    priority: classifyPriority(score),
    score,
    rationale: reasons.join("; ")
  };
}

function classifyEvent(event, context = {}) {
  const start = new Date(event.start?.dateTime ?? 0);
  const minutesAway = Math.round((start.getTime() - Date.now()) / 60000);
  let score = 3;
  const reasons = [];
  if (minutesAway >= -60 && minutesAway <= 240) {
    score += 3;
    reasons.push("meeting is near-term");
  }
  if (event.isOnlineMeeting) {
    score += 1;
    reasons.push("online meeting may need prep");
  }
  const overlap = sharedContextOverlap(event.subject, context);
  if (overlap > 0) {
    score += 1;
    reasons.push("meeting overlaps with active communication context");
  }
  return {
    triageClass: "meeting_followup",
    priority: classifyPriority(score),
    score,
    rationale: reasons.join("; ")
  };
}

function classifyTeams(row, context = {}) {
  const from = normalizeText(row.from);
  const body = normalizeText(row.bodyPreview);
  let score = 3;
  const reasons = [];
  if (from.includes("workflows") || from.includes("power automate")) {
    score -= 2;
    reasons.push("automation sender");
  }
  if (/\?|please|review|need|action|follow up|urgent/.test(body)) {
    score += 3;
    reasons.push("message contains action-oriented language");
  }
  if (row.teamName || row.channelName) {
    score += 1;
    reasons.push("message is anchored to a known workspace");
  }
  const overlap = sharedContextOverlap(`${row.teamName ?? ""} ${row.channelName ?? ""} ${body}`, context);
  if (overlap > 0) {
    score += Math.min(2, overlap);
    reasons.push("message lines up with active client/project context");
  }
  return {
    triageClass: score <= 2 ? "automation_noise" : score >= 6 ? "client_risk" : "important_fyi",
    priority: classifyPriority(score),
    score,
    rationale: reasons.join("; ")
  };
}

export function buildTriageItems(outputs = []) {
  const items = [];
  const context = buildCrossDomainContext(outputs);
  for (const out of outputs) {
    const action = out?.artifacts?.action;
    const result = out?.artifacts?.result ?? {};
    if (action?.agent === "ms.outlook") {
      for (const message of result.messages ?? []) {
        const classification = classifyEmail(message, context);
        items.push({
          id: `email:${message.id}`,
          title: message.subject || "(no subject)",
          sourceDomain: "outlook",
          sourceArtifactId: message.id,
          triageClass: classification.triageClass,
          priority: classification.priority,
          rationale: classification.rationale,
          evidence: [message]
        });
      }
      if (result.id) {
        const classification = classifyEmail(result, context);
        items.push({
          id: `email:${result.id}`,
          title: result.subject || "(no subject)",
          sourceDomain: "outlook",
          sourceArtifactId: result.id,
          triageClass: classification.triageClass,
          priority: classification.priority,
          rationale: classification.rationale,
          evidence: [result]
        });
      }
    }
    if (action?.agent === "ms.calendar") {
      for (const event of result.events ?? []) {
        const classification = classifyEvent(event, context);
        items.push({
          id: `calendar:${event.webLink ?? event.subject}`,
          title: event.subject || "(untitled event)",
          sourceDomain: "calendar",
          sourceArtifactId: event.webLink ?? event.subject,
          triageClass: classification.triageClass,
          priority: classification.priority,
          rationale: classification.rationale,
          evidence: [event]
        });
      }
    }
    if (action?.agent === "ms.teams") {
      for (const row of [...(result.prioritized ?? []), ...(result.hits ?? [])].slice(0, 10)) {
        const classification = classifyTeams(row, context);
        items.push({
          id: `teams:${row.id}`,
          title: row.teamName || row.channelName || row.chatTopic || row.from || "Teams message",
          sourceDomain: "teams",
          sourceArtifactId: row.id,
          triageClass: classification.triageClass,
          priority: classification.priority,
          rationale: classification.rationale,
          evidence: [row]
        });
      }
    }
  }
  return items.sort((a, b) => priorityWeight(b.priority) - priorityWeight(a.priority));
}

export function summarizeTriage(items = []) {
  const counts = items.reduce((acc, item) => {
    acc[item.triageClass] = (acc[item.triageClass] ?? 0) + 1;
    return acc;
  }, {});
  const top = items.slice(0, 3);
  const summary = [];
  if (top.length === 0) {
    summary.push("I did not find any high-signal follow-up items across the reviewed workstreams.");
  } else {
    summary.push(`I found ${top.length} items worth attention first.`);
  }
  if (counts.needs_response) summary.push(`${counts.needs_response} likely need a response.`);
  if (counts.meeting_followup) summary.push(`${counts.meeting_followup} look like meeting prep or follow-up.`);
  if (counts.client_risk) summary.push(`${counts.client_risk} carry client/project risk.`);
  if (counts.automation_noise) summary.push(`${counts.automation_noise} look like noise or automation.`);
  return summary.join(" ");
}

function priorityWeight(priority) {
  if (priority === "high") return 3;
  if (priority === "medium") return 2;
  return 1;
}

function buildCrossDomainContext(outputs = []) {
  const tokens = new Map();
  for (const out of outputs) {
    const action = out?.artifacts?.action;
    const result = out?.artifacts?.result ?? {};
    if (action?.agent === "ms.calendar") {
      for (const event of result.events ?? []) {
        for (const token of tokenize(`${event.subject ?? ""} ${event.location ?? ""}`)) {
          tokens.set(token, (tokens.get(token) ?? 0) + 1);
        }
      }
    }
    if (action?.agent === "ms.outlook") {
      for (const message of result.messages ?? []) {
        for (const token of tokenize(`${message.subject ?? ""} ${message.from ?? ""}`)) {
          tokens.set(token, (tokens.get(token) ?? 0) + 1);
        }
      }
    }
    if (action?.agent === "ms.teams") {
      for (const row of [...(result.prioritized ?? []), ...(result.hits ?? [])]) {
        for (const token of tokenize(`${row.teamName ?? ""} ${row.channelName ?? ""} ${row.bodyPreview ?? ""}`)) {
          tokens.set(token, (tokens.get(token) ?? 0) + 1);
        }
      }
    }
  }
  return {
    repeatedTokens: [...tokens.entries()].filter(([, count]) => count >= 2).map(([token]) => token)
  };
}

function sharedContextOverlap(text, context = {}) {
  const repeated = new Set(context.repeatedTokens ?? []);
  if (repeated.size === 0) return 0;
  let count = 0;
  for (const token of tokenize(text)) {
    if (repeated.has(token)) count += 1;
  }
  return count;
}
