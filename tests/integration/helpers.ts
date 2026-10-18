import { db } from "@/lib/server/db";
import { publicOrgId } from "@/lib/server/org";
import { toISODate } from "@/lib/search/params";

/** The seeded Sigma organization, whose catalogue the public site shows. */
export const sigmaOrgId = publicOrgId;

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

/**
 * A home that sleeps at least `guests`, optionally with/without the pets amenity. One-night minimum unless
 * `minNights` says otherwise, so short test stays are bookable. Preferably one whose minimum no seeded season or
 * event raises (the year-end holidays take 3 nights in the Médina riads and outside town), so that minimum holds
 * whatever the date the suite runs; in a neighbourhood where every such home has one (Palmeraie), the first home.
 */
export async function findHome(opts: { guests?: number; pets?: boolean; place?: string; minNights?: number } = {}) {
  const where = {
    organizationId: await sigmaOrgId(),
    category: "HOME" as const,
    maxGuests: { gte: opts.guests ?? 2 },
    minNights: opts.minNights ?? 1,
    ...(opts.place && { place: { slug: opts.place } }),
    ...(opts.pets === true && { amenities: { some: { amenityId: "animaux" } } }),
    ...(opts.pets === false && { amenities: { none: { amenityId: "animaux" } } }),
  };
  const l =
    (await db.listing.findFirst({ where: { ...where, priceRules: { none: { rule: { minNights: { gt: opts.minNights ?? 1 } } } } }, orderBy: { id: "asc" } })) ??
    (await db.listing.findFirst({ where, orderBy: { id: "asc" } }));
  if (!l) throw new Error("no matching seeded home");
  return l;
}
