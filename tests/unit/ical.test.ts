import { describe, expect, it } from "vitest";
import { escapeText, foldLine, listingCalendar } from "@/lib/ical";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("iCal export", () => {
  const ics = listingCalendar("1000", [
    { id: "bk_1", checkIn: d("2027-02-13"), checkOut: d("2027-02-20"), createdAt: new Date("2026-10-13T17:03:15.123Z") },
    { id: "bk_2", checkIn: d("2027-02-20"), checkOut: d("2027-02-22"), createdAt: new Date("2026-11-01T08:00:00Z") },
  ]);

  it("uses CRLF line endings only", () => {
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("wraps one all-day event per stay in a calendar, checkout exclusive", () => {
    const lines = ics.split("\r\n");
    expect(lines.slice(0, 2)).toEqual(["BEGIN:VCALENDAR", "VERSION:2.0"]);
    expect(lines).toContain("PRODID:-//Nidou//Calendrier des logements//FR");
    expect(lines.at(-2)).toBe("END:VCALENDAR");
    expect(lines.filter((l) => l === "BEGIN:VEVENT")).toHaveLength(2);
    expect(lines.filter((l) => l === "END:VEVENT")).toHaveLength(2);
    const first = lines.slice(lines.indexOf("BEGIN:VEVENT"), lines.indexOf("END:VEVENT") + 1);
    expect(first).toEqual([
      "BEGIN:VEVENT",
      "UID:bk_1@nidou.fr",
      "DTSTAMP:20261013T170315Z",
      "DTSTART;VALUE=DATE:20270213",
      // The checkout day itself is free: DTEND is exclusive.
      "DTEND;VALUE=DATE:20270220",
      "SUMMARY:Réservé (Nidou)",
      "TRANSP:OPAQUE",
      "END:VEVENT",
    ]);
  });

  it("has no METHOD, so the stable DTSTAMP reads as the last revision (RFC 5545 §3.8.7.2)", () => {
    expect(ics).not.toMatch(/^METHOD:/m);
  });

  it("carries no guest data", () => {
    expect(ics).not.toMatch(/ATTENDEE|ORGANIZER|DESCRIPTION|guest|@demo|voyageur/i);
  });

  it("is a valid empty calendar without stays", () => {
    expect(listingCalendar("1000", []).split("\r\n").filter(Boolean)).toEqual([
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Nidou//Calendrier des logements//FR",
      "CALSCALE:GREGORIAN",
      "X-WR-CALNAME:Nidou · logement 1000",
    ].concat("END:VCALENDAR"));
  });

  it("escapes text and folds long lines at 75 octets without splitting characters", () => {
    expect(escapeText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
    const long = `SUMMARY:${"é".repeat(60)}`;
    const folded = foldLine(long);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
    for (const p of parts.slice(1)) expect(p.startsWith(" ")).toBe(true);
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join("")).toBe(long);
    expect(foldLine("SHORT:line")).toBe("SHORT:line");
  });
});
