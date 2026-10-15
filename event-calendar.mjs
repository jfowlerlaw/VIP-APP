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
