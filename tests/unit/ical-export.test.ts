import { describe, expect, it } from "vitest";
import { isoDay } from "@/lib/admin/calendar";
import { busyRanges, EXPORT_UID_DOMAIN, isEcho, mergedRuns, overlapsWithBuffer } from "@/lib/channels/busy";
import { buildCalendar, EXPORT_SUMMARY, foldLine } from "@/lib/channels/ical/build";
import { parseIcal } from "@/lib/channels/ical/parse";
import { exportTokenMatches, exportUrl, generateExportToken, hashExportToken, tokenFromFile } from "@/lib/channels/token";

/** Sigma's export (lib/channels/busy.ts, lib/channels/ical/build.ts): anti-loop, buffers, notice, nothing personal, RFC 5545. */

const D = (s: string) => new Date(`${s}T00:00:00Z`);
const today = D("2027-01-01");
const bookings = [
  { id: "b-direct", source: "DIRECT" as const, checkIn: D("2027-01-10"), checkOut: D("2027-01-13") },
  { id: "b-airbnb", source: "AIRBNB" as const, checkIn: D("2027-01-20"), checkOut: D("2027-01-22") },
  { id: "b-booking", source: "BOOKING" as const, checkIn: D("2027-02-01"), checkOut: D("2027-02-04") },
  { id: "b-owner", source: "OWNER" as const, checkIn: D("2027-02-10"), checkOut: D("2027-02-12") },
  { id: "b-past", source: "DIRECT" as const, checkIn: D("2026-12-20"), checkOut: D("2026-12-28") },
];
const ranges = (platform: "AIRBNB" | "BOOKING", prep = 0, notice = 0) =>
  busyRanges({ platform, bookings, preparationDays: prep, minNoticeDays: notice, today, salt: "org1" }).map((r) => `${isoDay(r.start)}→${isoDay(r.end)}`);

describe("busy ranges", () => {
  it("every source except the platform's own (anti-loop); past stays left out", () => {
    expect(ranges("AIRBNB")).toEqual(["2027-01-10→2027-01-13", "2027-02-01→2027-02-04", "2027-02-10→2027-02-12"]);
    expect(ranges("BOOKING")).toEqual(["2027-01-10→2027-01-13", "2027-01-20→2027-01-22", "2027-02-10→2027-02-12"]);
  });

  it("preparation days widen both sides; the notice blocks from today", () => {
    expect(ranges("AIRBNB", 1, 2)).toEqual(["2027-01-01→2027-01-03", "2027-01-09→2027-01-14", "2027-01-31→2027-02-05", "2027-02-09→2027-02-13"]);
  });

  it("open conflicts of other platforms are busy too", () => {
    const r = busyRanges({ platform: "AIRBNB", bookings: [], conflicts: [{ id: "c1", source: "BOOKING", checkIn: D("2027-03-01"), checkOut: D("2027-03-03") }, { id: "c2", source: "AIRBNB", checkIn: D("2027-04-01"), checkOut: D("2027-04-03") }], preparationDays: 0, minNoticeDays: 0, today, salt: "o" });
    expect(r.map((x) => isoDay(x.start))).toEqual(["2027-03-01"]);
  });

  it("UIDs: stable per booking, different per organization, never the booking's id", () => {
    const a = busyRanges({ platform: "AIRBNB", bookings, preparationDays: 0, minNoticeDays: 0, today, salt: "org1" });
    const b = busyRanges({ platform: "AIRBNB", bookings, preparationDays: 2, minNoticeDays: 0, today, salt: "org1" });
    const c = busyRanges({ platform: "AIRBNB", bookings, preparationDays: 0, minNoticeDays: 0, today, salt: "org2" });
    expect(a.map((r) => r.uid)).toEqual(b.map((r) => r.uid));
    expect(a[0].uid).not.toBe(c[0].uid);
    for (const r of a) {
      expect(r.uid).toMatch(new RegExp(`^[0-9a-f]{32}@${EXPORT_UID_DOMAIN.replace(".", "\\.")}$`));
      expect(r.uid).not.toContain("b-direct");
    }
  });

  it("merged runs and echo detection", () => {
    const rs = [
      { start: D("2027-01-10"), end: D("2027-01-13") },
      { start: D("2027-01-13"), end: D("2027-01-15") },
      { start: D("2027-01-20"), end: D("2027-01-22") },
    ];
    expect(mergedRuns(rs).map((r) => `${isoDay(r.start)}→${isoDay(r.end)}`)).toEqual(["2027-01-10→2027-01-15", "2027-01-20→2027-01-22"]);
    expect(isEcho({ checkIn: D("2027-01-10"), checkOut: D("2027-01-13") }, rs)).toBe(true);
    expect(isEcho({ checkIn: D("2027-01-10"), checkOut: D("2027-01-15") }, rs)).toBe(true);
    expect(isEcho({ checkIn: D("2027-01-11"), checkOut: D("2027-01-13") }, rs)).toBe(false);
    expect(isEcho({ checkIn: D("2027-01-20"), checkOut: D("2027-01-23") }, rs)).toBe(false);
  });

  it("buffer overlap", () => {
    const a = { checkIn: D("2027-01-13"), checkOut: D("2027-01-15") };
    const b = { checkIn: D("2027-01-10"), checkOut: D("2027-01-13") };
    expect(overlapsWithBuffer(a, b, 0)).toBe(false);
    expect(overlapsWithBuffer(a, b, 1)).toBe(true);
  });
});

describe("the .ics file", () => {
  const now = new Date("2027-01-01T08:00:00Z");
  const r = busyRanges({ platform: "AIRBNB", bookings: bookings.map((b) => ({ ...b, createdAt: new Date("2026-12-01T10:00:00Z") })), preparationDays: 0, minNoticeDays: 1, today, salt: "org1" });
  const text = buildCalendar(r, { now });

  it("CRLF everywhere, lines ≤ 75 octets, VCALENDAR with one VEVENT per range", () => {
    expect(text.endsWith("\r\n")).toBe(true);
    expect(text.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    for (const l of text.split("\r\n")) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(r.length);
    expect(text).toContain("DTSTART;VALUE=DATE:20270110\r\nDTEND;VALUE=DATE:20270113");
    expect(text).toContain("DTSTAMP:20261201T100000Z");
  });

  it("nothing personal: only dates, the generic summary and opaque UIDs", () => {
    expect(text).not.toMatch(/DESCRIPTION|ATTENDEE|ORGANIZER|LOCATION|b-direct|AIRBNB|BOOKING|OWNER|DIRECT/);
    const summaries = [...text.matchAll(/^SUMMARY:(.*)$/gm)].map((m) => m[1].trim());
    expect(new Set(summaries)).toEqual(new Set([EXPORT_SUMMARY]));
  });

  it("reads back with Sigma's own parser", () => {
    const cal = parseIcal(text);
    expect(cal.events.map((e) => [e.start, e.end, e.summary])).toEqual(
      r.map((x) => [
        { kind: "date", date: isoDay(x.start) },
        { kind: "date", date: isoDay(x.end) },
        EXPORT_SUMMARY,
      ]),
    );
  });

  it("folding never splits a character", () => {
    const line = `SUMMARY:${"é".repeat(60)}`;
    const folded = foldLine(line);
    for (const l of folded.split("\r\n")) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    expect(folded.split("\r\n ").join("")).toBe(line);
  });
});

describe("export tokens", () => {
  it("256 bits, hashed, matched in constant time, in a .ics path", () => {
    const t = generateExportToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateExportToken()).not.toBe(t);
    expect(hashExportToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(exportTokenMatches(t, hashExportToken(t))).toBe(true);
    expect(exportTokenMatches(generateExportToken(), hashExportToken(t))).toBe(false);
    expect(exportUrl("https://sigma.ma/", t)).toBe(`https://sigma.ma/ical/${t}.ics`);
    expect(tokenFromFile(`${t}.ics`)).toBe(t);
    expect(tokenFromFile(t)).toBeNull();
    expect(tokenFromFile(`${t}.ics.ics`)).toBeNull();
  });
});
