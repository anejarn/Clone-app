import { db } from "@/lib/server/db";
import { toISODate } from "@/lib/search/params";

let n = 0;
export async function makeUser(name = "Test") {
  n += 1;
  return db.user.create({ data: { name, email: `${name.toLowerCase()}-${Date.now()}-${n}@test.sigma.test` } });
}

const DAY = 86_400_000;
export function utcToday() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
/** yyyy-MM-dd `days` from today (UTC). Far-future offsets avoid the seeded stays (3–60 days out). */
export function day(days: number) {
  return toISODate(new Date(utcToday().getTime() + days * DAY));
}

/** A home that sleeps at least `guests`, optionally with/without the pets amenity. */
export async function findHome(opts: { guests?: number; pets?: boolean; place?: string } = {}) {
  const l = await db.listing.findFirst({
    where: {
      category: "HOME",
      maxGuests: { gte: opts.guests ?? 2 },
      ...(opts.place && { place: { slug: opts.place } }),
      ...(opts.pets === true && { amenities: { some: { amenityId: "animaux" } } }),
      ...(opts.pets === false && { amenities: { none: { amenityId: "animaux" } } }),
    },
    orderBy: { id: "asc" },
  });
  if (!l) throw new Error("no matching seeded home");
  return l;
}
