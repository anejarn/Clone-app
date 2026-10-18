import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isoDay } from "@/lib/admin/calendar";
import { calendarEvents } from "@/lib/channels/ical/adapter";
import { IcalParseError, parseContentLine, parseDuration, parseIcal, parseIcalDate, resolveTimeZone, unescapeText, unfoldLines } from "@/lib/channels/ical/parse";
import { platform } from "@/lib/channels/platforms";

/** The RFC 5545 reader (lib/channels/ical/parse.ts) and the platforms' anonymized sample feeds (tests/fixtures/ical/). */

const fixture = (name: string) => readFileSync(new URL(`../fixtures/ical/${name}`, import.meta.url), "utf8");
const cal = (body: string, eol = "\r\n") => ["BEGIN:VCALENDAR", "VERSION:2.0", ...body.trim().split("\n"), "END:VCALENDAR"].join(eol);
const ev = (...lines: string[]) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\n");
const nights = (name: string, source: Parameters<typeof platform>[0]) =>
  calendarEvents(platform(source), parseIcal(fixture(name))).events.map((e) => ({ ref: e.ref, nights: `${isoDay(e.checkIn)}→${isoDay(e.checkOut)}`, kind: e.kind, ambiguous: e.ambiguous, cancelled: e.cancelled }));

describe("content lines", () => {
  it("unfolds lines that start with a space or a tab, whatever the line ends", () => {
    for (const eol of ["\r\n", "\n", "\r"]) {
      const lines = unfoldLines(["SUMMARY:Hel", " lo", "\tWorld", "UID:1"].join(eol));
      expect(lines.map((l) => l.text)).toEqual(["SUMMARY:HelloWorld", "UID:1"]);
      expect(lines[1].line).toBe(4);
    }
  });

  it("drops a byte order mark and blank lines", () => {
    expect(unfoldLines("﻿BEGIN:VCALENDAR\r\n\r\nEND:VCALENDAR").map((l) => l.text)).toEqual(["BEGIN:VCALENDAR", "END:VCALENDAR"]);
  });

  it("reads parameters, quoted values included", () => {
    expect(parseContentLine('DTSTART;TZID="Europe/Paris:x";VALUE=DATE-TIME:20270105T150000')).toEqual({
      name: "DTSTART",
      params: { TZID: "Europe/Paris:x", VALUE: "DATE-TIME" },
      value: "20270105T150000",
    });
    expect(parseContentLine("summary:a:b")).toEqual({ name: "SUMMARY", params: {}, value: "a:b" });
    expect(parseContentLine("NOCOLON")).toBeNull();
  });

  it("unescapes text", () => {
    expect(unescapeText("a\\, b\\; c\\\\d\\ne\\Nf")).toBe("a, b; c\\d\ne\nf");
  });
});

describe("dates", () => {
  it("DATE, with or without VALUE=DATE; invalid dates refused", () => {
    expect(parseIcalDate("20270105", {})).toEqual({ kind: "date", date: "2027-01-05" });
    expect(parseIcalDate("20270105", { VALUE: "DATE" })).toEqual({ kind: "date", date: "2027-01-05" });
    expect(parseIcalDate("20270230", {})).toBeNull();
    expect(parseIcalDate("2027-01-05", {})).toBeNull();
  });

  it("DATE-TIME in UTC, with a TZID (IANA, Windows, vendor path) or floating", () => {
    expect(parseIcalDate("20270105T150000Z", {})).toEqual({ kind: "utc", instant: Date.UTC(2027, 0, 5, 15) });
    expect(parseIcalDate("20270105T1500Z", {})).toEqual({ kind: "utc", instant: Date.UTC(2027, 0, 5, 15) });
    expect(parseIcalDate("20270105T150000", { TZID: "Europe/Paris" })).toMatchObject({ kind: "zoned", timeZone: "Europe/Paris" });
    expect(parseIcalDate("20270105T150000", { TZID: "Morocco Standard Time" })).toMatchObject({ kind: "zoned", timeZone: "Africa/Casablanca" });
    expect(parseIcalDate("20270105T150000", { TZID: "/mozilla.org/20050126_1/Europe/Paris" })).toMatchObject({ kind: "zoned", timeZone: "Europe/Paris" });
    expect(parseIcalDate("20270105T150000", { TZID: "UTC" })).toEqual({ kind: "utc", instant: Date.UTC(2027, 0, 5, 15) });
    expect(parseIcalDate("20270105T150000", {})).toMatchObject({ kind: "floating", wall: { year: 2027, month: 1, day: 5, hour: 15 } });
    const warnings: string[] = [];
    expect(parseIcalDate("20270105T150000", { TZID: "Planet/Mars" }, warnings)).toMatchObject({ kind: "floating" });
    expect(warnings[0]).toMatch(/Fuseau horaire inconnu/);
    expect(parseIcalDate("20270105T250000Z", {})).toBeNull();
  });

  it("time zone names", () => {
    expect(resolveTimeZone("Africa/Casablanca")).toBe("Africa/Casablanca");
    expect(resolveTimeZone("(UTC+01:00) Casablanca")).toBe("Africa/Casablanca");
    expect(resolveTimeZone("nowhere")).toBeNull();
  });

  it("durations", () => {
    expect(parseDuration("P3D")).toEqual({ ms: 3 * 86_400_000, days: 3 });
    expect(parseDuration("P1W")).toEqual({ ms: 7 * 86_400_000, days: 7 });
    expect(parseDuration("PT36H")).toEqual({ ms: 36 * 3_600_000, days: 0 });
    expect(parseDuration("P1DT2H30M")).toEqual({ ms: 86_400_000 + 9_000_000, days: 1 });
    expect(parseDuration("-P1D")).toBeNull();
    expect(parseDuration("P")).toBeNull();
    expect(parseDuration("P1DT")).toBeNull();
  });
});

describe("calendars", () => {
  it("reads events, skips VTIMEZONE and VALARM, keeps unknown properties out", () => {
    const c = parseIcal(
      cal(
        [
          "PRODID:-//Test//EN",
          "X-WR-CALNAME:Riad\\, test",
          "BEGIN:VTIMEZONE",
          "TZID:Europe/Paris",
          "BEGIN:STANDARD",
          "DTSTART:19701025T030000",
          "END:STANDARD",
          "END:VTIMEZONE",
          ev("UID:a", "DTSTART;VALUE=DATE:20270105", "DTEND;VALUE=DATE:20270108", "SUMMARY:Reserved", "X-FOO:bar", "BEGIN:VALARM", "DTSTART:20000101", "UID:alarm", "END:VALARM"),
          ev("UID:b", "DTSTART:20270201", "STATUS:cancelled"),
        ].join("\n"),
      ),
    );
    expect(c.prodId).toBe("-//Test//EN");
    expect(c.name).toBe("Riad, test");
    expect(c.events.map((e) => [e.uid, e.summary, e.status, e.start, e.end])).toEqual([
      ["a", "Reserved", null, { kind: "date", date: "2027-01-05" }, { kind: "date", date: "2027-01-08" }],
      ["b", "", "CANCELLED", { kind: "date", date: "2027-02-01" }, null],
    ]);
  });

  it("skips an event without a readable DTSTART, with a warning (no guest data in it)", () => {
    const c = parseIcal(cal([ev("UID:a", "SUMMARY:Jean Dupont"), ev("UID:b", "DTSTART:garbage"), ev("UID:c", "DTSTART:20270101")].join("\n")));
    expect(c.events.map((e) => e.uid)).toEqual(["c"]);
    expect(c.warnings).toHaveLength(2);
    expect(c.warnings.join(" ")).not.toContain("Dupont");
  });

  it("notes recurring events (first occurrence only)", () => {
    const c = parseIcal(cal(ev("UID:r", "DTSTART;VALUE=DATE:20270101", "RRULE:FREQ=WEEKLY")));
    expect(c.events[0].recurring).toBe(true);
    expect(c.warnings[0]).toMatch(/RRULE/);
  });

  it("refuses what isn't a calendar, a truncated file and too many events", () => {
    const code = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return e instanceof IcalParseError ? e.code : "other";
      }
      return "none";
    };
    expect(code(() => parseIcal("<html><body>Not found</body></html>"))).toBe("NOT_ICALENDAR");
    expect(code(() => parseIcal(""))).toBe("NOT_ICALENDAR");
    expect(code(() => parseIcal("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20270101\r\n"))).toBe("UNTERMINATED");
    const many = cal(Array.from({ length: 4 }, (_, i) => ev(`UID:${i}`, "DTSTART:20270101")).join("\n"));
    expect(code(() => parseIcal(many, { maxEvents: 3 }))).toBe("TOO_MANY_EVENTS");
  });

  it("LF-only and CR-only files read the same as CRLF", () => {
    const body = ev("UID:a", "DTSTART;VALUE=DATE:20270105", "DTEND;VALUE=DATE:20270108");
    const a = parseIcal(cal(body, "\r\n")).events;
    expect(parseIcal(cal(body, "\n")).events).toEqual(a);
    expect(parseIcal(cal(body, "\r")).events).toEqual(a);
  });
});

describe("platform samples (anonymized)", () => {
  it("Airbnb: « Reserved » with its HM code, « Not available » blocks; folded description", () => {
    expect(nights("airbnb.ics", "AIRBNB")).toEqual([
      { ref: "HMTEST0001", nights: "2027-01-10→2027-01-15", kind: "reservation", ambiguous: false, cancelled: false },
      { ref: "7f3a2b1c0d9e-00000000000000000000000000000002@airbnb.com", nights: "2027-02-01→2027-02-03", kind: "block", ambiguous: true, cancelled: false },
      { ref: "HMTEST0003", nights: "2027-03-15→2027-03-20", kind: "reservation", ambiguous: false, cancelled: false },
    ]);
  });

  it("Booking.com: « CLOSED - Not available » are reservations to check against the export; BOM and LF", () => {
    expect(nights("booking.ics", "BOOKING")).toEqual([
      { ref: "00000000000000000000000000000b01@booking.com", nights: "2027-01-20→2027-01-23", kind: "reservation", ambiguous: true, cancelled: false },
      { ref: "00000000000000000000000000000b02@booking.com", nights: "2027-02-05→2027-02-06", kind: "reservation", ambiguous: true, cancelled: false },
    ]);
  });

  it("Agoda: UTC date-times turned into nights in Marrakech (Ramadan UTC+0, then UTC+1), DURATION", () => {
    expect(nights("agoda.ics", "AGODA").map((e) => [e.ref, e.nights, e.kind])).toEqual([
      ["agoda-000000001", "2027-03-05→2027-03-08", "reservation"],
      // 23:30 UTC on 04/03/2027 is 23:30 in Marrakech during Ramadan (UTC+0): the 4th.
      ["agoda-000000002", "2027-03-04→2027-03-06", "reservation"],
      // 23:30 UTC on 19/03/2027 is 00:30 on the 20th in Marrakech (UTC+1 again).
      ["agoda-000000003", "2027-03-20→2027-03-21", "reservation"],
      ["agoda-block-1", "2027-04-01→2027-04-03", "block"],
    ]);
  });

  it("Trip.com: TZID Asia/Shanghai (quoted or not), escaped summary, VALARM, STATUS:CANCELLED", () => {
    const c = parseIcal(fixture("tripcom.ics"));
    expect(c.events[0].summary).toBe("Trip.com reservation, confirmed; ref 0000000000000001");
    expect(nights("tripcom.ics", "TRIPCOM")).toEqual([
      { ref: "trip-0000000000000001@trip.com", nights: "2027-04-10→2027-04-13", kind: "reservation", ambiguous: false, cancelled: false },
      // 06:00 in Shanghai on the 12th is 23:00 on the 11th in Marrakech.
      { ref: "trip-0000000000000002@trip.com", nights: "2027-04-11→2027-04-13", kind: "reservation", ambiguous: false, cancelled: false },
      { ref: "trip-0000000000000003@trip.com", nights: "2027-04-20→2027-04-22", kind: "reservation", ambiguous: false, cancelled: true },
    ]);
  });

  it("an event without UID gets a stable reference; duplicates and invalid dates are skipped", () => {
    const text = cal(
      [
        ev("DTSTART;VALUE=DATE:20270105", "DTEND;VALUE=DATE:20270107", "SUMMARY:Reserved"),
        ev("UID:x", "DTSTART;VALUE=DATE:20270110", "DTEND;VALUE=DATE:20270112"),
        ev("UID:x", "DTSTART;VALUE=DATE:20270120", "DTEND;VALUE=DATE:20270122"),
        ev("UID:y", "DTSTART;VALUE=DATE:20270110", "DTEND;VALUE=DATE:20270108"),
      ].join("\n"),
    );
    const a = calendarEvents(platform("OTHER"), parseIcal(text));
    const b = calendarEvents(platform("OTHER"), parseIcal(text));
    expect(a.events.map((e) => e.ref)).toEqual([a.events[0].ref, "x"]);
    expect(a.events[0].ref).toMatch(/^sans-uid-[0-9a-f]{24}$/);
    expect(b.events[0].ref).toBe(a.events[0].ref);
    expect(a.skipped.map((s) => s.reason)).toEqual(["DUPLICATE", "INVALID_DATES"]);
  });

  it("recognises Sigma's own export coming back", () => {
    const text = cal(ev("UID:abc@sigma.ical", "DTSTART;VALUE=DATE:20270105", "DTEND;VALUE=DATE:20270107", "SUMMARY:Sigma – indisponible"));
    expect(calendarEvents(platform("BOOKING"), parseIcal(text)).events[0].ownExport).toBe(true);
  });
});
