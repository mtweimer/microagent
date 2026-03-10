function resolveStart(when, now = new Date()) {
  if (!when || when === "unspecified") return nextHour(now);

  const lower = String(when).toLowerCase();
  const explicit = new Date(when);
  if (!Number.isNaN(explicit.getTime())) return explicit;

  const base = new Date(now);
  if (lower.includes("tomorrow")) {
    base.setDate(base.getDate() + 1);
  }
  if (lower.includes("next tuesday")) shiftToWeekday(base, 2, true);
  if (lower.includes("next wednesday")) shiftToWeekday(base, 3, true);
  if (lower.includes("next thursday")) shiftToWeekday(base, 4, true);
  if (lower.includes("next friday")) shiftToWeekday(base, 5, true);
  if (lower.includes("next monday")) shiftToWeekday(base, 1, true);

  const parsedTime = parseTime(lower);
  if (parsedTime) {
    base.setHours(parsedTime.hour, parsedTime.minute, 0, 0);
    return base;
  }
  return nextHour(base);
}

function normalizeAttendees(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (typeof item === "string" && isEmail(item)) {
      out.push(item.toLowerCase());
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const address = item.emailAddress?.address ?? item.email ?? item.address;
    if (typeof address === "string" && isEmail(address)) out.push(address.toLowerCase());
  }
  return [...new Set(out)];
}

function parseTime(text) {
  const match = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const suffix = match[3];
  if (suffix === "pm" && hour < 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function nextHour(now) {
  const d = new Date(now);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

function shiftToWeekday(date, weekday, forceNextWeek = false) {
  const current = date.getDay();
  let delta = (weekday - current + 7) % 7;
  if (delta === 0 || forceNextWeek) delta += 7;
  date.setDate(date.getDate() + delta);
}

function toGraphDateTime(value) {
  return value.toISOString().replace("Z", "");
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? "").trim());
}

export async function scheduleEventAction(env, ctx) {
  const graph = ctx.graphClient;
  const now = new Date();
  const start = resolveStart(env.params?.when, now);
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  const eventBody = {
    subject: env.params?.title || "New event",
    start: { dateTime: toGraphDateTime(start), timeZone: "UTC" },
    end: { dateTime: toGraphDateTime(end), timeZone: "UTC" },
    attendees: normalizeAttendees(env.params?.attendees).map((addr) => ({
      emailAddress: { address: addr },
      type: "required"
    }))
  };
  if (typeof env.params?.description === "string" && env.params.description.trim()) {
    eventBody.body = {
      contentType: "Text",
      content: env.params.description.trim()
    };
  }
  if (typeof env.params?.body === "string" && env.params.body.trim()) {
    eventBody.body = {
      contentType: "Text",
      content: env.params.body.trim()
    };
  }

  const created = await graph.post("/me/events", eventBody);
  return {
    status: "ok",
    message: `Calendar event scheduled: ${created.subject}`,
    artifacts: {
      id: created.id,
      subject: created.subject,
      start: created.start,
      end: created.end,
      webLink: created.webLink
    }
  };
}
