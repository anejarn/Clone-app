/**
 * A small RFC 5545 (iCalendar) reader for the platforms' availability feeds (Airbnb, Booking.com, Agoda, Trip.com,
 * Vrbo…). Pure, no dependency, no time zone database of its own: it only reads what the file says and returns the
 * events' raw dates; lib/channels/nights.ts turns them into nights in Africa/Casablanca.
 *
 * Handled: a byte order mark, CRLF, LF or CR line ends, folded lines (a line starting with a space or a tab
 * continues the previous one), property parameters (quoted values may hold « : » and « ; »), escaped text
 * (\n \N \, \; \\), DTSTART/DTEND as DATE (VALUE=DATE or 8 digits), DATE-TIME in UTC (…Z), with a TZID (IANA name,
 * a Windows name or a « /vendor/…/Region/City » path) or floating (local time), DURATION instead of DTEND,
 * STATUS:CANCELLED, VTIMEZONE and VALARM blocks (skipped), unknown properties and components (ignored).
 * Not handled: recurrence (RRULE: only the first occurrence is kept, with a warning; no platform uses it for
 * reservations), VTIMEZONE rules (the TZID's name is looked up in the runtime's database instead).
 */

export interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export type IcalDate =
  /** All-day: a calendar date. */
  | { kind: "date"; date: string }
  /** An instant (…Z). */
  | { kind: "utc"; instant: number }
  /** A wall-clock time in a named zone (IANA name, already mapped from Windows names). */
  | { kind: "zoned"; wall: WallTime; timeZone: string }
  /** A wall-clock time without zone: « local time », read as the home's (Africa/Casablanca). */
  | { kind: "floating"; wall: WallTime };

export interface IcalEvent {
  uid: string | null;
  summary: string;
  description: string;
  /** Upper case: CONFIRMED, TENTATIVE, CANCELLED… or null. */
  status: string | null;
  start: IcalDate;
  end: IcalDate | null;
  /** DURATION when there is no DTEND, in milliseconds (days count as 24 h, weeks as 7 days). */
  durationMs: number | null;
  /** Whole days of the DURATION (P3D, P1W): added to a DATE start as calendar days. */
  durationDays: number | null;
  recurring: boolean;
  /** Line of BEGIN:VEVENT (1-based), for the warnings. */
  line: number;
}

export interface IcalCalendar {
  prodId: string | null;
  name: string | null;
  events: IcalEvent[];
  /** Events skipped (no or unreadable DTSTART) and other oddities; never contains a guest's data. */
  warnings: string[];
}

export type IcalErrorCode = "NOT_ICALENDAR" | "UNTERMINATED" | "TOO_MANY_EVENTS";

export class IcalParseError extends Error {
  constructor(
    public readonly code: IcalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "IcalParseError";
  }
}

export interface ContentLine {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** Splits into unfolded logical lines, with the line number each one starts on. */
export function unfoldLines(text: string): { text: string; line: number }[] {
  const raw = text.replace(/^﻿/, "").split(/\r\n|\n|\r/);
  const out: { text: string; line: number }[] = [];
  raw.forEach((l, i) => {
    if ((l.startsWith(" ") || l.startsWith("\t")) && out.length) out[out.length - 1].text += l.slice(1);
    else if (l.length) out.push({ text: l, line: i + 1 });
  });
  return out;
}

/** One content line: NAME;PARAM=VALUE;PARAM="quoted:value":value. Null when it has no colon. */
export function parseContentLine(line: string): ContentLine | null {
  let i = 0;
  let quoted = false;
  const parts: string[] = [];
  let current = "";
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      quoted = !quoted;
      current += c;
    } else if (!quoted && c === ";") {
      parts.push(current);
      current = "";
    } else if (!quoted && c === ":") {
      parts.push(current);
      break;
    } else current += c;
  }
  if (i >= line.length) return null;
  const [name, ...rawParams] = parts;
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf("=");
    if (eq < 0) continue;
    params[p.slice(0, eq).trim().toUpperCase()] = p.slice(eq + 1).replace(/^"(.*)"$/, "$1");
  }
  return { name: name.trim().toUpperCase(), params, value: line.slice(i + 1) };
}

/** TEXT values: \n or \N = new line, \, \; \\ = the character. */
export function unescapeText(value: string): string {
  return value.replace(/\\([nN,;\\])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

const WINDOWS_ZONES: Record<string, string> = {
  "morocco standard time": "Africa/Casablanca",
  "romance standard time": "Europe/Paris",
  "w. europe standard time": "Europe/Berlin",
  "central europe standard time": "Europe/Budapest",
  "central european standard time": "Europe/Warsaw",
  "gmt standard time": "Europe/London",
  "greenwich standard time": "Atlantic/Reykjavik",
  "e. europe standard time": "Europe/Chisinau",
  "utc": "UTC",
  "coordinated universal time": "UTC",
  "china standard time": "Asia/Shanghai",
  "singapore standard time": "Asia/Singapore",
  "tokyo standard time": "Asia/Tokyo",
  "korea standard time": "Asia/Seoul",
  "eastern standard time": "America/New_York",
  "central standard time": "America/Chicago",
  "pacific standard time": "America/Los_Angeles",
};

const validZones = new Map<string, boolean>();
function isTimeZone(name: string): boolean {
  let ok = validZones.get(name);
  if (ok === undefined) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: name });
      ok = true;
    } catch {
      ok = false;
    }
    validZones.set(name, ok);
  }
  return ok;
}

/** An IANA zone name for a TZID, or null when none can be found. */
export function resolveTimeZone(tzid: string): string | null {
  const t = tzid.trim();
  if (!t) return null;
  if (isTimeZone(t)) return t;
  const win = WINDOWS_ZONES[t.toLowerCase()];
  if (win) return win;
  // "/mozilla.org/20050126_1/Europe/Paris", "(UTC+01:00) Casablanca"…
  const m = /([A-Za-z]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?)$/.exec(t);
  if (m && isTimeZone(m[1])) return m[1];
  if (/casablanca|morocco|maroc/i.test(t)) return "Africa/Casablanca";
  return null;
}

function realDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** DTSTART / DTEND value with its parameters. Null when unreadable. */
export function parseIcalDate(value: string, params: Record<string, string>, warnings?: string[]): IcalDate | null {
  const v = value.trim();
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (date || params.VALUE?.toUpperCase() === "DATE") {
    const m = date ?? /^(\d{4})(\d{2})(\d{2})/.exec(v);
    if (!m) return null;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return realDate(y, mo, d) ? { kind: "date", date: `${m[1]}-${m[2]}-${m[3]}` } : null;
  }
  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/i.exec(v);
  if (!dt) return null;
  const wall: WallTime = {
    year: Number(dt[1]),
    month: Number(dt[2]),
    day: Number(dt[3]),
    hour: Number(dt[4]),
    minute: Number(dt[5]),
    second: Number(dt[6] ?? 0),
  };
  if (!realDate(wall.year, wall.month, wall.day) || wall.hour > 23 || wall.minute > 59 || wall.second > 60) return null;
  if (dt[7]) return { kind: "utc", instant: Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, Math.min(wall.second, 59)) };
  if (params.TZID) {
    const zone = resolveTimeZone(params.TZID);
    if (zone) return zone === "UTC" ? { kind: "utc", instant: Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, Math.min(wall.second, 59)) } : { kind: "zoned", wall, timeZone: zone };
    warnings?.push(`Fuseau horaire inconnu « ${params.TZID.slice(0, 60)} » : heure lue comme heure de Marrakech.`);
  }
  return { kind: "floating", wall };
}

/** DURATION (RFC 5545 §3.3.6): P15DT5H0M20S, P7W, -P1D (negative refused). */
export function parseDuration(value: string): { ms: number; days: number } | null {
  const m = /^\+?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!m || value.trim() === "P" || /T$/.test(value.trim())) return null;
  const [w, d, h, mi, s] = m.slice(1).map((x) => Number(x ?? 0));
  const days = w * 7 + d;
  return { ms: days * 86_400_000 + h * 3_600_000 + mi * 60_000 + s * 1000, days };
}

export function formatWall(w: WallTime): string {
  return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

export interface ParseOptions {
  /** A feed with more events is refused (a platform's file has a few hundred at most). */
  maxEvents?: number;
}

export function parseIcal(text: string, opts: ParseOptions = {}): IcalCalendar {
  const maxEvents = opts.maxEvents ?? 5000;
  const lines = unfoldLines(text);
  const first = lines[0] ? parseContentLine(lines[0].text) : null;
  if (!first || first.name !== "BEGIN" || first.value.trim().toUpperCase() !== "VCALENDAR") {
    throw new IcalParseError("NOT_ICALENDAR", "Ce fichier n'est pas un calendrier iCal (BEGIN:VCALENDAR attendu).");
  }
  const cal: IcalCalendar = { prodId: null, name: null, events: [], warnings: [] };
  const stack: string[] = [];
  let ev: { props: ContentLine[]; line: number } | null = null;
  let closed = false;

  for (const { text: l, line } of lines) {
    const cl = parseContentLine(l);
    if (!cl) continue;
    if (cl.name === "BEGIN") {
      const comp = cl.value.trim().toUpperCase();
      stack.push(comp);
      if (comp === "VEVENT" && stack.length === 2 && stack[0] === "VCALENDAR") ev = { props: [], line };
      continue;
    }
    if (cl.name === "END") {
      const comp = cl.value.trim().toUpperCase();
      // Tolerate a missing END of an inner block: unwind to the matching BEGIN.
      const at = stack.lastIndexOf(comp);
      if (at < 0) continue;
      stack.length = at;
      if (comp === "VEVENT" && ev && stack.length === 1) {
        const parsed = toEvent(ev.props, ev.line, cal.warnings);
        if (parsed) {
          cal.events.push(parsed);
          if (cal.events.length > maxEvents) throw new IcalParseError("TOO_MANY_EVENTS", `Plus de ${maxEvents} événements : fichier refusé.`);
        }
        ev = null;
      }
      if (comp === "VCALENDAR" && stack.length === 0) closed = true;
      continue;
    }
    if (closed) continue;
    if (ev && stack.length === 2 && stack[1] === "VEVENT") ev.props.push(cl);
    else if (stack.length === 1) {
      if (cl.name === "PRODID") cal.prodId = unescapeText(cl.value).slice(0, 200);
      if (cl.name === "X-WR-CALNAME") cal.name = unescapeText(cl.value).slice(0, 200);
    }
  }
  if (!closed) throw new IcalParseError("UNTERMINATED", "Calendrier iCal incomplet (END:VCALENDAR manquant) : fichier tronqué ?");
  return cal;
}

function toEvent(props: ContentLine[], line: number, warnings: string[]): IcalEvent | null {
  const get = (name: string) => props.find((p) => p.name === name);
  const dtstart = get("DTSTART");
  if (!dtstart) {
    warnings.push(`Événement ligne ${line} sans DTSTART : ignoré.`);
    return null;
  }
  const start = parseIcalDate(dtstart.value, dtstart.params, warnings);
  if (!start) {
    warnings.push(`Événement ligne ${line} : date de début illisible, ignoré.`);
    return null;
  }
  const dtend = get("DTEND");
  let end: IcalDate | null = null;
  if (dtend) {
    end = parseIcalDate(dtend.value, dtend.params, warnings);
    if (!end) warnings.push(`Événement ligne ${line} : date de fin illisible, une nuit retenue.`);
  }
  const duration = !dtend && get("DURATION") ? parseDuration(get("DURATION")!.value) : null;
  const rrule = !!get("RRULE");
  if (rrule) warnings.push(`Événement ligne ${line} récurrent (RRULE) : seule la première occurrence est lue.`);
  const uid = get("UID") ? unescapeText(get("UID")!.value).trim() : "";
  return {
    uid: uid || null,
    summary: get("SUMMARY") ? unescapeText(get("SUMMARY")!.value).trim() : "",
    description: get("DESCRIPTION") ? unescapeText(get("DESCRIPTION")!.value) : "",
    status: get("STATUS") ? get("STATUS")!.value.trim().toUpperCase() : null,
    start,
    end,
    durationMs: duration?.ms ?? null,
    durationDays: duration?.days ?? null,
    recurring: rrule,
    line,
  };
}
