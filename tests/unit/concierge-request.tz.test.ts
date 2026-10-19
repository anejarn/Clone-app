import { describe, expect, it } from "vitest";
import { checkRequestTiming, earliestDay, parseIsoDay, parseRequestForm } from "@/lib/concierge/request";

/**
 * A guest's service request (Lot 4b): the form's checks and the timing rule — a day of the stay (arrival to departure,
 * both included), at least the lead time ahead, in Marrakech time (UTC+1; UTC+0 during Ramadan: in 2027 from 07/02
 * 03:00 to 14/03 02:00). Also run with TZ=Pacific/Kiritimati and America/Los_Angeles: the machine's zone never matters.
 */

const TZ = "Africa/Casablanca";
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const stay = { checkIn: d("2026-11-20"), checkOut: d("2026-11-24") };
const base = { serviceId: "svc_demo_hammam", date: "2026-11-22", time: "18:00", quantity: "1", persons: "2", note: "", phone: "+34 600 000 000" };

describe("parseIsoDay", () => {
  it("reads real calendar days only", () => {
    expect(parseIsoDay("2026-11-22")?.toISOString()).toBe("2026-11-22T00:00:00.000Z");
    expect(parseIsoDay("2026-02-30")).toBeNull();
    expect(parseIsoDay("22/11/2026")).toBeNull();
    expect(parseIsoDay("")).toBeNull();
  });
});

describe("parseRequestForm", () => {
  it("accepts a complete request, with defaults for empty counts", () => {
    const r = parseRequestForm({ ...base, quantity: "", note: "  Allergie aux noix  " }, ["massage", "massage"]);
    expect(r).toEqual({ ok: true, input: { serviceId: "svc_demo_hammam", day: d("2026-11-22"), minutes: 1080, quantity: 1, persons: 2, optionIds: ["massage"], note: "Allergie aux noix", phone: "+34 600 000 000" } });
  });

  it("flags every wrong field with its code", () => {
    const r = parseRequestForm({ serviceId: "../x", date: "2026-13-01", time: "25:00", quantity: "0", persons: "51", note: "x".repeat(1001), phone: "abc" }, ["BAD!"]);
    expect(r).toEqual({ ok: false, errors: { service: true, date: true, time: true, quantity: true, persons: true, options: true, note: true, phone: true } });
  });

  it("requires a phone with at least 6 digits, refuses control characters in the note", () => {
    expect(parseRequestForm({ ...base, phone: "" }, [])).toMatchObject({ ok: false, errors: { phone: true } });
    expect(parseRequestForm({ ...base, phone: "+1 23" }, [])).toMatchObject({ ok: false, errors: { phone: true } });
    expect(parseRequestForm({ ...base, phone: "06 00 00 00 00" }, [])).toMatchObject({ ok: true });
    expect(parseRequestForm({ ...base, note: "a\u0000b" }, [])).toMatchObject({ ok: false, errors: { note: true } });
  });

  it("refuses more than 10 options", () => {
    expect(parseRequestForm(base, Array.from({ length: 11 }, (_, i) => `o${i}`))).toMatchObject({ ok: false, errors: { options: true } });
  });
});

describe("checkRequestTiming (Africa/Casablanca)", () => {
  const at = (iso: string) => new Date(iso);

  it("allows any day from arrival to departure, both included", () => {
    const now = at("2026-11-10T10:00:00Z");
    for (const day of ["2026-11-20", "2026-11-22", "2026-11-24"]) {
      expect(checkRequestTiming({ day: d(day), minutes: 9 * 60, ...stay, leadTimeHours: 24, now, timeZone: TZ }).ok).toBe(true);
    }
    for (const day of ["2026-11-19", "2026-11-25"]) {
      expect(checkRequestTiming({ day: d(day), minutes: 9 * 60, ...stay, leadTimeHours: 24, now, timeZone: TZ })).toEqual({ ok: false, reason: "outsideStay" });
    }
  });

  it("schedules the local wall-clock time: 18:00 in Marrakech is 17:00 UTC in November", () => {
    const r = checkRequestTiming({ day: d("2026-11-22"), minutes: 18 * 60, ...stay, leadTimeHours: 4, now: at("2026-11-21T00:00:00Z"), timeZone: TZ });
    expect(r).toEqual({ ok: true, scheduledAt: at("2026-11-22T17:00:00.000Z") });
  });

  it("enforces the lead time to the minute", () => {
    // 22/11 18:00 local = 17:00 UTC. With 4 h of notice, asking at 13:00 UTC (14:00 local) is just in time.
    const opts = { day: d("2026-11-22"), minutes: 18 * 60, ...stay, leadTimeHours: 4, timeZone: TZ };
    expect(checkRequestTiming({ ...opts, now: at("2026-11-22T13:00:00Z") }).ok).toBe(true);
    expect(checkRequestTiming({ ...opts, now: at("2026-11-22T13:00:01Z") })).toEqual({ ok: false, reason: "tooSoon" });
    expect(checkRequestTiming({ ...opts, now: at("2026-11-22T17:00:00Z") })).toEqual({ ok: false, reason: "past" });
    expect(checkRequestTiming({ ...opts, leadTimeHours: 0, now: at("2026-11-22T16:59:00Z") }).ok).toBe(true);
  });

  it("uses UTC+0 during Ramadan 2027: 18:00 local is 18:00 UTC", () => {
    const r = checkRequestTiming({ day: d("2027-02-20"), minutes: 18 * 60, checkIn: d("2027-02-18"), checkOut: d("2027-02-22"), leadTimeHours: 24, now: at("2027-02-19T17:59:00Z"), timeZone: TZ });
    expect(r).toEqual({ ok: true, scheduledAt: at("2027-02-20T18:00:00.000Z") });
    // Exactly 24 h less one minute ahead: too soon.
    expect(checkRequestTiming({ day: d("2027-02-20"), minutes: 18 * 60, checkIn: d("2027-02-18"), checkOut: d("2027-02-22"), leadTimeHours: 24, now: at("2027-02-19T18:01:00Z"), timeZone: TZ })).toEqual({ ok: false, reason: "tooSoon" });
  });

  it("an hour skipped by the Ramadan switch is moved forward, never refused as past by mistake", () => {
    // 14/03/2027: clocks go from 02:00 to 03:00. 02:30 does not exist; it reads as 03:30 local (02:30 UTC).
    const r = checkRequestTiming({ day: d("2027-03-14"), minutes: 2 * 60 + 30, checkIn: d("2027-03-13"), checkOut: d("2027-03-15"), leadTimeHours: 0, now: at("2027-03-13T12:00:00Z"), timeZone: TZ });
    expect(r.ok).toBe(true);
  });
});

describe("earliestDay", () => {
  it("is the later of the arrival and today (plus whole days of lead time)", () => {
    expect(earliestDay({ checkIn: d("2026-11-20"), leadTimeHours: 0, localToday: d("2026-11-10") })).toEqual(d("2026-11-20"));
    expect(earliestDay({ checkIn: d("2026-11-20"), leadTimeHours: 0, localToday: d("2026-11-22") })).toEqual(d("2026-11-22"));
    expect(earliestDay({ checkIn: d("2026-11-20"), leadTimeHours: 48, localToday: d("2026-11-22") })).toEqual(d("2026-11-24"));
  });
});
