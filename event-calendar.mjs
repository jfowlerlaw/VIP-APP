const eventDateFormatters = new Map();

function eventDateFormatter(timeZone) {
  const zone = timeZone || "America/New_York";
  if (!eventDateFormatters.has(zone)) {
    try {
      eventDateFormatters.set(zone, new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "numeric", day: "numeric" }));
    } catch {
      return eventDateFormatter("America/New_York");
    }
  }
  return eventDateFormatters.get(zone);
}

function calendarDay(timestamp, formatter) {
  return Object.fromEntries(formatter.formatToParts(timestamp)
    .filter(({ type }) => ["year", "month", "day"].includes(type))
    .map(({ type, value }) => [type, Number(value)]));
}

function dayNumber({ year, month, day }) {
  return year * 10000 + month * 100 + day;
}

function dateLabelDay(event, formatter) {
  const label = String(event.dateLabel || "").trim();
  let year, month, day;
  let match;
  if ((match = label.match(/^(\d{4})-(\d{2})-(\d{2})$/))) {
    [, year, month, day] = match.map(Number);
  } else if ((match = label.match(/^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/i))) {
    month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(match[1].slice(0, 3).toLowerCase()) + 1;
    day = Number(match[2]);
    year = Number(match[3]) || null;
  } else if ((match = label.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/))) {
    month = Number(match[1]);
    day = Number(match[2]);
    year = Number(match[3]) || null;
  } else {
    return null;
  }
  if (!year) {
    const createdAt = Date.parse(event.createdAt);
    if (!Number.isFinite(createdAt)) return null;
    const created = calendarDay(createdAt, formatter);
    year = created.year + (month * 100 + day < created.month * 100 + created.day ? 1 : 0);
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day };
}

function endOfEventDay(day, formatter) {
  const midnight = Date.UTC(day.year, day.month - 1, day.day);
  let before = midnight - 36 * 60 * 60 * 1000;
  let after = midnight + 72 * 60 * 60 * 1000;
  // Find the next local calendar day, including time-zone and daylight-saving changes.
  while (after - before > 1) {
    const middle = Math.floor((before + after) / 2);
    if (dayNumber(calendarDay(middle, formatter)) <= dayNumber(day)) before = middle;
    else after = middle;
  }
  return new Date(after).toISOString();
}

export function getEventSchedule(event) {
  const formatter = eventDateFormatter(event.timeZone);
  const start = Date.parse(event.startsAt);
  const end = Date.parse(event.endsAt);
  const day = Number.isFinite(start) ? calendarDay(start, formatter) : dateLabelDay(event, formatter);
  return {
    sortAt: Number.isFinite(start) ? new Date(start).toISOString()
      : day ? new Date(Date.UTC(day.year, day.month - 1, day.day, 12)).toISOString() : null,
    expiresAt: Number.isFinite(end) && (!Number.isFinite(start) || end > start) ? new Date(end).toISOString()
      : day ? endOfEventDay(day, formatter) : null,
  };
}

export function buildEventCalendar(event, now = new Date()) {
  const startsAt = new Date(event.startsAt);
  const endsAt = new Date(event.endsAt);
  if (!event.startsAt || !event.endsAt || !Number.isFinite(+startsAt) || !Number.isFinite(+endsAt) || endsAt <= startsAt) {
    throw new Error("This event does not have a confirmed start and end time yet.");
  }
  const stamp = (date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const text = (value) => String(value || "").replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Just Call Moe//VIP Events//EN",
    "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
    `UID:${encodeURIComponent(event.id)}@vip.justcallmoe.com`, `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(startsAt)}`, `DTEND:${stamp(endsAt)}`,
    `SUMMARY:${text(event.title)}`, `DESCRIPTION:${text(event.copy)}`,
    `LOCATION:${text([event.location, event.address, event.city].filter(Boolean).join(", "))}`,
  ];
  try {
    const url = new URL(event.eventbriteUrl || event.eventUrl);
    if (["http:", "https:"].includes(url.protocol)) lines.push(`URL:${url.href}`);
  } catch {
    // Events without a registration link can still be added to a calendar.
  }
  lines.push("END:VEVENT", "END:VCALENDAR");
  // Fold at UTF-8 character boundaries, including the continuation space in the 75-byte limit.
  return lines.map((line) => {
    let result = "";
    let bytes = 0;
    for (const char of line) {
      const size = Buffer.byteLength(char);
      if (bytes + size > 75) {
        result += "\r\n ";
        bytes = 1;
      }
      result += char;
      bytes += size;
    }
    return result;
  }).join("\r\n") + "\r\n";
}
