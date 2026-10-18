import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { nightsBetween, ruleCoversNight, stayNights, type PricingRule } from "@/lib/pricing";
import { ANYWHERE, fromISODate, slugify, totalGuests, type SearchQuery } from "@/lib/search/params";
import type { Place } from "@/lib/types";
import { cardSelect, searchHref, toCard, type CardData } from "./cards";
import { db } from "./db";
import { pricingRules } from "./pricing";

/**
 * Catalogue reads. Plain async functions with no Next.js cache calls, so integration tests can call them
 * directly; lib/data/repo.ts wraps the ones pages use with "use cache".
 * Every listing read takes the organization whose catalogue it shows (lib/server/org.ts); places are shared
 * reference data (Marrakech neighbourhoods).
 */

const DAY = 86_400_000;
export const PAGE_SIZE = 24;

/** Only published listings are public: drafts stay in the back-office (search, detail, favourites, booking). */
export const PUBLISHED = { status: "PUBLISHED" } as const satisfies Prisma.ListingWhereInput;

const placeSelect = { slug: true, name: true, country: true, tagline: true, imageUrl: true } satisfies Prisma.PlaceSelect;
const toPlace = (p: Prisma.PlaceGetPayload<{ select: typeof placeSelect }>): Place => ({
  slug: p.slug,
  name: p.name,
  country: p.country,
  tagline: p.tagline,
  image: p.imageUrl,
});

/** Listings with no confirmed stay overlapping [from, to). */
export function availableBetween(from: Date, to: Date): Prisma.ListingWhereInput {
  return { bookings: { none: { status: "CONFIRMED", checkIn: { lt: to }, checkOut: { gt: from } } } };
}

/**
 * Homes a stay of [checkin, checkout) can be booked in: free on those dates, and whose minimum stay fits, the
 * listing's own (minNights) as raised by the organization's seasons and events covering one of the nights
 * (effectiveMinNights, lib/pricing/engine.ts). Same rule as quoteStay, so search never shows a home the quote would
 * refuse. Conditions go in AND, so a caller can still add its own `id` filter.
 */
export async function bookableBetween(orgId: string, checkin: Date, checkout: Date): Promise<Prisma.ListingWhereInput> {
  const nights = nightsBetween(checkin, checkout);
  const stay = stayNights(checkin, checkout);
  const raising = (await pricingRules(orgId, { from: checkin, to: checkout, minNightsAbove: nights })).filter((r) => stay.some((n) => ruleCoversNight(r, n)));
  if (raising.some((r) => r.listingIds === null)) return { AND: [{ id: { in: [] } }] };
  const excluded = [...new Set(raising.flatMap((r) => r.listingIds ?? []))];
  return {
    ...availableBetween(checkin, checkout),
    AND: [{ minNights: { lte: nights } }, ...(excluded.length ? [{ id: { notIn: excluded } }] : [])],
  };
}

/** The rules that can price a night of [checkin, checkout), for the cards' stay totals. */
const cardRules = (orgId: string, checkin?: Date, checkout?: Date): Promise<PricingRule[]> =>
  checkin && checkout && checkout > checkin ? pricingRules(orgId, { from: checkin, to: checkout }) : Promise.resolve([]);

const bestFirst: Prisma.ListingOrderByWithRelationInput[] = [
  { isGuestFavorite: "desc" },
  { ratingAvg: { sort: "desc", nulls: "last" } },
  { id: "asc" },
];

export async function listPlaces(): Promise<Place[]> {
  const rows = await db.place.findMany({ select: placeSelect, orderBy: { listings: { _count: "desc" } } });
  return rows.map(toPlace);
}

/** Autosuggest: accent- and case-insensitive match on the place name, or on its country. */
export async function suggestPlaces(query: string, limit = 8): Promise<Place[]> {
  const q = slugify(query);
  const rows = await db.place.findMany({
    where: q ? { OR: [{ searchName: { contains: q } }, { country: { startsWith: query.trim(), mode: "insensitive" } }] } : {},
    select: placeSelect,
    orderBy: q ? { searchName: "asc" } : { listings: { _count: "desc" } },
    take: limit,
  });
  // Names that start with the query rank before names that merely contain it.
  return rows.map(toPlace).sort((a, b) => Number(slugify(b.name).startsWith(q)) - Number(slugify(a.name).startsWith(q)));
}

/** Resolve a URL segment ("ourika", "Route de l'Ourika", "route-de-l-ourika") to a known place. */
export async function findPlace(segment: string): Promise<Place | null> {
  const s = slugify(decodeURIComponent(segment));
  if (!s) return null;
  const row = await db.place.findFirst({ where: { OR: [{ slug: s }, { searchName: s }] }, select: placeSelect });
  return row && toPlace(row);
}

function utcMidnight(ms: number): Date {
  const d = new Date(ms);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Friday → Sunday (or Monday, a long weekend of 3 nights), `weeksAhead` weeks after the next Friday following `now`. */
export function weekend(now: number, weeksAhead: number, nights = 2): [Date, Date] {
  const today = utcMidnight(now);
  const toFriday = (5 - today.getUTCDay() + 7) % 7 || 7;
  const start = new Date(today.getTime() + (toFriday + 7 * weeksAhead) * DAY);
  return [start, new Date(start.getTime() + nights * DAY)];
}

export type HomeCategory = "all" | "homes" | "experiences" | "services";

export type HomeSection =
  | { kind: "destinations"; title: string; places: Place[] }
  | { kind: "services"; title: string }
  | { kind: "listings"; title: string; href: string; cards: CardData[] };

/** `placeSlug` null: every neighbourhood. */
async function availableHomesSection(
  orgId: string,
  title: string,
  placeSlug: string | null,
  [checkin, checkout]: [Date, Date],
  extra: Prisma.ListingWhereInput = {},
): Promise<HomeSection> {
  const [bookable, rules] = await Promise.all([bookableBetween(orgId, checkin, checkout), cardRules(orgId, checkin, checkout)]);
  const rows = await db.listing.findMany({
    where: { organizationId: orgId, category: "HOME", ...PUBLISHED, ...(placeSlug && { place: { slug: placeSlug } }), ...bookable, ...extra },
    select: cardSelect,
    orderBy: bestFirst,
    take: 14,
  });
  return {
    kind: "listings",
    title,
    href: searchHref(placeSlug ?? ANYWHERE, {}),
    cards: rows.map((l) => toCard(l, { checkin, checkout, rules })),
  };
}

async function experiencesSection(orgId: string, title: string, placeSlugs: string[] | null): Promise<HomeSection> {
  const rows = await db.listing.findMany({
    where: { organizationId: orgId, category: "EXPERIENCE", ...PUBLISHED, ...(placeSlugs && { place: { slug: { in: placeSlugs } } }) },
    select: cardSelect,
    orderBy: bestFirst,
    take: 14,
  });
  return { kind: "listings", title, href: searchHref(placeSlugs?.[0] ?? ANYWHERE, {}), cards: rows.map((l) => toCard(l)) };
}

const villasWithPool: Prisma.ListingWhereInput = { propertyType: "VILLA", amenities: { some: { amenityId: "piscine" } } };
/** Outside the city: where the day trips start. */
const OUT_OF_TOWN = ["ourika", "agafay", "palmeraie"];

/**
 * Homepage rows per category tab. Listing rows only show homes bookable on the dates they advertise (free, minimum
 * stay met); the villas, which take 3 nights, are advertised for a long weekend.
 */
export async function homeSections(orgId: string, category: HomeCategory, now: number): Promise<HomeSection[]> {
  const nonEmpty = (sections: HomeSection[]) => sections.filter((s) => s.kind !== "listings" || s.cards.length > 0);
  const destinations = async (): Promise<HomeSection> => ({ kind: "destinations", title: "Quartiers de Marrakech", places: await listPlaces() });
  const services: HomeSection = { kind: "services", title: "Services de conciergerie Sigma" };

  switch (category) {
    case "homes":
      return nonEmpty(
        await Promise.all([
          availableHomesSection(orgId, "Logements populaires · Hivernage", "hivernage", weekend(now, 0)),
          availableHomesSection(orgId, "Libres ce week-end · Guéliz", "gueliz", weekend(now, 0)),
          availableHomesSection(orgId, "Villas avec piscine · Palmeraie", "palmeraie", weekend(now, 1, 3), villasWithPool),
          availableHomesSection(orgId, "Au calme · Route de l'Ourika", "ourika", weekend(now, 2)),
          availableHomesSection(orgId, "Hôtels et chambres · Marrakech", null, weekend(now, 1), { propertyType: { in: ["HOTEL", "ROOM"] } }),
        ]),
      );
    case "experiences":
      return nonEmpty(
        await Promise.all([
          experiencesSection(orgId, "Activités populaires · Marrakech", null),
          experiencesSection(orgId, "Excursions hors de la ville", OUT_OF_TOWN),
        ]),
      );
    case "services":
      return [services, await destinations()];
    default:
      return nonEmpty(
        await Promise.all([
          destinations(),
          Promise.resolve(services),
          availableHomesSection(orgId, "Logements populaires · Hivernage", "hivernage", weekend(now, 0)),
          availableHomesSection(orgId, "Villas avec piscine · Palmeraie", "palmeraie", weekend(now, 1, 3), villasWithPool),
          experiencesSection(orgId, "Activités populaires · Marrakech", null),
          availableHomesSection(orgId, "Libres le mois prochain · Médina", "medina", weekend(now, 4)),
          availableHomesSection(orgId, "Logements · Agafay", "agafay", weekend(now, 1)),
        ]),
      );
  }
}

export interface SearchResult {
  place: Place | null;
  /** Place name, the raw segment for unknown places, "" for anywhere. */
  label: string;
  cards: CardData[];
  total: number;
  page: number;
  pageCount: number;
  nights: number;
}

/**
 * Homes for a destination segment and query: enough room for the guests, bookable on the dates (free, minimum stay
 * met: bookableBetween), pet-friendly when pets come along. With dates, cards show the stay's exact total. "partout" searches everywhere; any other unknown place has no results.
 * The pinned listing (clicked on the homepage) leads page 1.
 */
export async function searchHomes(orgId: string, segment: string, q: SearchQuery, page = 1): Promise<SearchResult> {
  const anywhere = segment === ANYWHERE;
  const place = anywhere ? null : await findPlace(segment);
  const label = place?.name ?? (anywhere ? "" : decodeURIComponent(segment));
  const checkin = q.checkin ? fromISODate(q.checkin) : undefined;
  const checkout = q.checkout ? fromISODate(q.checkout) : undefined;
  const nights = checkin && checkout ? nightsBetween(checkin, checkout) : 0;
  if (!anywhere && !place) return { place, label, cards: [], total: 0, page: 1, pageCount: 0, nights };

  const where: Prisma.ListingWhereInput = {
    organizationId: orgId,
    category: "HOME",
    ...PUBLISHED,
    ...(place && { place: { slug: place.slug } }),
    maxGuests: { gte: Math.max(1, totalGuests(q)) },
    ...(q.pets > 0 && { amenities: { some: { amenityId: "animaux" } } }),
    ...(checkin && checkout && (await bookableBetween(orgId, checkin, checkout))),
  };

  // The pinned listing only counts when it matches the filters; it then leads page 1 and is left out of
  // the ordered list everywhere, so pages never repeat or skip a card.
  const pinned = q.pinned ? await db.listing.findFirst({ where: { ...where, id: q.pinned }, select: cardSelect }) : null;
  const rest: Prisma.ListingWhereInput = pinned ? { ...where, id: { not: pinned.id } } : where;
  const offset = pinned ? 1 : 0;
  const [total, rows] = await Promise.all([
    db.listing.count({ where }),
    db.listing.findMany({
      where: rest,
      select: cardSelect,
      orderBy: bestFirst,
      skip: page === 1 ? 0 : (page - 1) * PAGE_SIZE - offset,
      take: page === 1 ? PAGE_SIZE - offset : PAGE_SIZE,
    }),
  ]);
  const opts = { checkin, checkout, rules: await cardRules(orgId, checkin, checkout) };
  return {
    place,
    label,
    total,
    page,
    pageCount: Math.ceil(total / PAGE_SIZE),
    nights,
    cards: [...(pinned && page === 1 ? [toCard(pinned, { ...opts, pinned: true })] : []), ...rows.map((l) => toCard(l, opts))],
  };
}

export async function cardsByIds(orgId: string, ids: string[]): Promise<CardData[]> {
  if (ids.length === 0) return [];
  const rows = await db.listing.findMany({ where: { organizationId: orgId, id: { in: ids }, ...PUBLISHED }, select: cardSelect });
  // Keep the caller's order (most recently saved first).
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => (byId.has(id) ? [toCard(byId.get(id)!)] : []));
}

/**
 * Public listing detail. An explicit select: the owner (propriétaire), the commission, the management type, the
 * street address and the 80-14 authorisation are internal and never leave the server through this read.
 */
export async function getListing(orgId: string, id: string) {
  return db.listing.findFirst({
    where: { id, organizationId: orgId, ...PUBLISHED },
    select: {
      id: true,
      category: true,
      propertyType: true,
      title: true,
      description: true,
      lat: true,
      lng: true,
      maxGuests: true,
      bedrooms: true,
      beds: true,
      bathrooms: true,
      priceCents: true,
      cleaningFeeCents: true,
      minNights: true,
      houseRules: true,
      isGuestFavorite: true,
      ratingAvg: true,
      reviewCount: true,
      place: { select: placeSelect },
      photos: { select: { url: true, alt: true }, orderBy: { position: "asc" } },
      amenities: { select: { amenity: { select: { id: true, label: true, icon: true, group: true } } } },
      reviews: {
        select: { id: true, rating: true, body: true, createdAt: true, author: { select: { name: true, image: true } } },
        orderBy: { createdAt: "desc" },
        take: 6,
      },
    },
  });
}

/** Whether this organization has a published listing with this id (any category). */
export async function listingExists(orgId: string, id: string): Promise<boolean> {
  return (await db.listing.count({ where: { id, organizationId: orgId, ...PUBLISHED } })) === 1;
}

/** Confirmed stays overlapping [from, to), for calendars. Dates are yyyy-MM-dd, checkout exclusive. */
export async function bookedRanges(orgId: string, listingId: string, from: Date, to: Date) {
  const rows = await db.booking.findMany({
    where: { organizationId: orgId, listingId, status: "CONFIRMED", checkIn: { lt: to }, checkOut: { gt: from } },
    select: { checkIn: true, checkOut: true },
    orderBy: { checkIn: "asc" },
  });
  return rows.map((r) => ({ checkIn: r.checkIn.toISOString().slice(0, 10), checkOut: r.checkOut.toISOString().slice(0, 10) }));
}
