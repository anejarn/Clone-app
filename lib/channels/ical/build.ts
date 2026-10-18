import { isoDay } from "../../admin/calendar";
import type { BusyRange } from "../busy";

/**
 * Sigma's iCal export (Lot 7): one all-day VEVENT per busy range, SUMMARY « Sigma – indisponible », a stable UID per
 * booking. Nothing personal: no guest name, no source, no amount, no listing title, no description. RFC 5545: CRLF
 * line ends, lines folded at 75 octets, DTEND exclusive.
 */

export const EXPORT_SUMMARY = "Sigma – indisponible";
export const EXPORT_PRODID = "-//Sigma SARL//Calendrier Sigma//FR";

const day = (d: Date) => isoDay(d).replaceAll("-", "");
const stamp = (d: Date) => `${d.toISOString().slice(0, 19).replace(/[-:]/g, "")}Z`;

/** Folds a content line at 75 octets (UTF-8), never inside a character. */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > limit) {
      parts.push(current);
      current = "";
      size = 0;
      limit = 74; // continuation lines start with a space
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

export interface BuildOptions {
  /** Used as DTSTAMP when a range has no stamp. */
  now: Date;
  name?: string;
}

export function buildCalendar(ranges: readonly BusyRange[], opts: BuildOptions): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${EXPORT_PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(opts.name ?? "Sigma")}`,
  ];
  for (const r of ranges) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${r.uid}`,
      `DTSTAMP:${stamp(r.stamp ?? opts.now)}`,
      `DTSTART;VALUE=DATE:${day(r.start)}`,
      `DTEND;VALUE=DATE:${day(r.end)}`,
      `SUMMARY:${escapeText(EXPORT_SUMMARY)}`,
      "TRANSP:OPAQUE",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
