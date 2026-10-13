import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/listings/[id]/calendar.ics/route";
import { cancelBooking, createBooking } from "@/lib/server/bookings";
import { db } from "@/lib/server/db";
import { day, findHome, makeUser } from "./helpers";

const calendar = (id: string) => GET(new Request(`http://localhost/api/listings/${id}/calendar.ics`), { params: Promise.resolve({ id }) });
const compact = (iso: string) => iso.replace(/-/g, "");

describe("GET /api/listings/:id/calendar.ics", () => {
  it("lists every confirmed stay as an all-day event, without guest data", async () => {
    const home = await findHome({ place: "orcieres-merlette", nth: 7 });
    const guest = await makeUser("Zelda");
    const kept = await createBooking(guest.id, stay(home.id, 280, 285));
    const cancelled = await createBooking(guest.id, stay(home.id, 290, 292));
    await cancelBooking(guest.id, cancelled.id);

    const res = await calendar(home.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    const ics = await res.text();
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);

    const confirmed = await db.booking.count({ where: { listingId: home.id, status: "CONFIRMED" } });
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(confirmed);
    expect(ics).toContain(`UID:${kept.id}@nidou.fr\r\n`);
    expect(ics).toContain(`DTSTART;VALUE=DATE:${compact(day(280))}\r\nDTEND;VALUE=DATE:${compact(day(285))}\r\n`);
    expect(ics).toContain("SUMMARY:Réservé (Nidou)\r\n");
    expect(ics).not.toContain(cancelled.id);
    expect(ics).not.toContain(guest.email);
    expect(ics).not.toContain(guest.name);
  });

  it("is 404 for unknown listings, malformed ids included", async () => {
    for (const id of ["missing", "\u0000"]) {
      const res = await calendar(id);
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe("NOT_FOUND");
    }
  });
});

function stay(listingId: string, from: number, to: number) {
  return { listingId, checkIn: day(from), checkOut: day(to), adults: 1, children: 0, infants: 0, pets: 0 };
}
