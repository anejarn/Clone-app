/**
 * iCalendar (RFC 5545) export of a listing's booked nights, for owners who also list elsewhere: their other
 * channels import the feed and block the nights sold on Nidou. All-day events, DTEND exclusive (the checkout
 * day is free again), no guest data.
 */

export interface CalendarStay {
  id: string;
  /** UTC midnights, checkout exclusive. */
  checkIn: Date;
  checkOut: Date;
  createdAt: Date;
}

const CRLF = "\r\n";
const encoder = new TextEncoder();

/** 20270213 */
const icsDate = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
/** 20261013T170315Z */
const icsTimestamp = (d: Date) => `${d.toISOString().slice(0, 19).replace(/[-:]/g, "")}Z`;

/** TEXT value escaping (RFC 5545 §3.3.11). */
export function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Folds a content line at 75 octets (RFC 5545 §3.1), never inside a UTF-8 character. */
export function foldLine(line: string): string {
  const parts: string[] = [];
  let current = "";
  let octets = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    // Continuation lines start with a space, which counts towards their 75 octets.
    if (octets + size > 75) {
      parts.push(current);
      current = " ";
      octets = 1;
    }
    current += ch;
    octets += size;
  }
  parts.push(current);
  return parts.join(CRLF);
}

export function listingCalendar(listingId: string, stays: CalendarStay[]): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Nidou//Calendrier des logements//FR",
    "CALSCALE:GREGORIAN",
    // No METHOD: with one, DTSTAMP would have to be the feed's generation time (RFC 5545 §3.8.7.2).
    `X-WR-CALNAME:${escapeText(`Nidou · logement ${listingId}`)}`,
  ];
  for (const s of stays) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${s.id}@nidou.fr`,
      // Without METHOD, DTSTAMP is the event's last revision: the booking's creation time, stable across polls.
      `DTSTAMP:${icsTimestamp(s.createdAt)}`,
      `DTSTART;VALUE=DATE:${icsDate(s.checkIn)}`,
      `DTEND;VALUE=DATE:${icsDate(s.checkOut)}`,
      `SUMMARY:${escapeText("Réservé (Nidou)")}`,
      "TRANSP:OPAQUE",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join(CRLF) + CRLF;
}
