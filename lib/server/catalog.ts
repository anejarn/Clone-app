import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { nightsBetween } from "@/lib/pricing";
import { ANYWHERE, fromISODate, slugify, totalGuests, type SearchQuery } from "@/lib/search/params";
import type { Place } from "@/lib/types";
import { cardSelect, searchHref, toCard, type CardData } from "./cards";
import { db } from "./db";

/**
 * Catalogue reads. Plain async functions with no Next.js cache calls, so integration tests can call them
 * directly; lib/data/repo.ts wraps the ones pages use with "use cache".
 */

const DAY = 86_400_000;
export const PAGE_SIZE = 24;

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

/** Resolve a URL segment ("paris", "Chamonix-Mont-Blanc", "chamonix") to a known place. */
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

/** Friday → Sunday, `weeksAhead` weeks after the next Friday following `now`. */
export function weekend(now: number, weeksAhead: number): [Date, Date] {
  const today = utcMidnight(now);
  const toFriday = (5 - today.getUTCDay() + 7) % 7 || 7;
  const start = new Date(today.getTime() + (toFriday + 7 * weeksAhead) * DAY);
  return [start, new Date(start.getTime() + 2 * DAY)];
}

export type HomeCategory = "all" | "homes" | "experiences" | "services";

export type HomeSection =
  | { kind: "destinations"; title: string; places: Place[] }
  | { kind: "services"; title: string }
  | { kind: "listings"; title: string; href: string; cards: CardData[] };

async function availableHomesSection(
  title: string,
  placeSlug: string,
  [checkin, checkout]: [Date, Date],
  extra: Prisma.ListingWhereInput = {},
): Promise<HomeSection> {
  const rows = await db.listing.findMany({
    where: { category: "HOME", place: { slug: placeSlug }, ...availableBetween(checkin, checkout), ...extra },
    select: cardSelect,
    orderBy: bestFirst,
    take: 14,
  });
  return {
    kind: "listings",
    title,
    href: searchHref(placeSlug, {}),
    cards: rows.map((l) => toCard(l, { checkin, checkout })),
  };
}

async function experiencesSection(title: string, placeSlugs: string[]): Promise<HomeSection> {
  const rows = await db.listing.findMany({
    where: { category: "EXPERIENCE", place: { slug: { in: placeSlugs } } },
    select: cardSelect,
    orderBy: bestFirst,
    take: 14,
  });
  return { kind: "listings", title, href: searchHref(placeSlugs[0], {}), cards: rows.map((l) => toCard(l)) };
}

/** Homepage rows per category tab. Listing rows only show homes free on the dates they advertise. */
export async function homeSections(category: HomeCategory, now: number): Promise<HomeSection[]> {
  const nonEmpty = (sections: HomeSection[]) => sections.filter((s) => s.kind !== "listings" || s.cards.length > 0);
  const destinations = async (): Promise<HomeSection> => ({ kind: "destinations", title: "Destinations pour vous", places: await listPlaces() });
  const services: HomeSection = { kind: "services", title: "Trouvez des services à proximité" };

  switch (category) {
    case "homes":
      return nonEmpty(
        await Promise.all([
          availableHomesSection("Logements populaires · Paris", "paris", weekend(now, 0)),
          availableHomesSection("Logements disponibles ce week-end · Marseille", "marseille", weekend(now, 0)),
          availableHomesSection("Chalets et appartements · Chamonix-Mont-Blanc", "chamonix", weekend(now, 1)),
          availableHomesSection("Logements · Lisbonne", "lisbonne", weekend(now, 2)),
          availableHomesSection("De superbes hôtels pour votre prochain voyage", "paris", weekend(now, 1), {
            propertyType: { in: ["HOTEL", "ROOM"] },
          }),
        ]),
      );
    case "experiences":
      return nonEmpty(
        await Promise.all([
          experiencesSection("Expériences populaires · France", ["paris", "lyon", "marseille", "bordeaux", "nice", "annecy"]),
          experiencesSection("Expériences · Voyage à l'étranger", ["lisbonne", "barcelone", "rome", "marrakech", "londres"]),
        ]),
      );
    case "services":
      return [services, await destinations()];
    default:
      return nonEmpty(
        await Promise.all([
          destinations(),
          Promise.resolve(services),
          availableHomesSection("Logements populaires · Paris", "paris", weekend(now, 0)),
          availableHomesSection("Logements disponibles le mois prochain · Nice", "nice", weekend(now, 4)),
          experiencesSection("Expériences populaires · France", ["paris", "lyon", "marseille", "bordeaux", "nice", "annecy"]),
          availableHomesSection("Logements · Biarritz", "biarritz", weekend(now, 1)),
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
 * Homes for a destination segment and query: enough room for the guests, free on the dates,
 * pet-friendly when pets come along. "partout" searches everywhere; any other unknown place has no results.
 * The pinned listing (clicked on the homepage) leads page 1.
 */
export async function searchHomes(segment: string, q: SearchQuery, page = 1): Promise<SearchResult> {
  const anywhere = segment === ANYWHERE;
  const place = anywhere ? null : await findPlace(segment);
  const label = place?.name ?? (anywhere ? "" : decodeURIComponent(segment));
  const checkin = q.checkin ? fromISODate(q.checkin) : undefined;
  const checkout = q.checkout ? fromISODate(q.checkout) : undefined;
  const nights = checkin && checkout ? nightsBetween(checkin, checkout) : 0;
  if (!anywhere && !place) return { place, label, cards: [], total: 0, page: 1, pageCount: 0, nights };

  const where: Prisma.ListingWhereInput = {
    category: "HOME",
    ...(place && { place: { slug: place.slug } }),
    maxGuests: { gte: Math.max(1, totalGuests(q)) },
    ...(q.pets > 0 && { amenities: { some: { amenityId: "animaux" } } }),
    ...(checkin && checkout && availableBetween(checkin, checkout)),
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
  const opts = { checkin, checkout, search: true };
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

export async function cardsByIds(ids: string[]): Promise<CardData[]> {
  if (ids.length === 0) return [];
  const rows = await db.listing.findMany({ where: { id: { in: ids } }, select: cardSelect });
  // Keep the caller's order (most recently saved first).
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => (byId.has(id) ? [toCard(byId.get(id)!)] : []));
}

export async function getListing(id: string) {
  return db.listing.findUnique({
    where: { id },
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
      isGuestFavorite: true,
      ratingAvg: true,
      reviewCount: true,
      place: { select: placeSelect },
      host: { select: { id: true, name: true, image: true, isProfessional: true, createdAt: true } },
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

/** Whether a listing with this id exists (any category). */
export async function listingExists(id: string): Promise<boolean> {
  return (await db.listing.count({ where: { id } })) === 1;
}

/** Confirmed stays overlapping [from, to), for calendars. Dates are yyyy-MM-dd, checkout exclusive. */
export async function bookedRanges(listingId: string, from: Date, to: Date) {
  const rows = await db.booking.findMany({
    where: { listingId, status: "CONFIRMED", checkIn: { lt: to }, checkOut: { gt: from } },
    select: { checkIn: true, checkOut: true },
    orderBy: { checkIn: "asc" },
  });
  return rows.map((r) => ({ checkIn: r.checkIn.toISOString().slice(0, 10), checkOut: r.checkOut.toISOString().slice(0, 10) }));
}
