import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { SKI_IN_MAX_M } from "@/lib/labels";
import { nightsBetween } from "@/lib/pricing";
import { ANYWHERE, fromISODate, slugify, totalGuests, TYPE_FILTERS, type SearchQuery } from "@/lib/search/params";
import type { Place } from "@/lib/types";
import { cardSelect, searchHref, toCard, type CardData } from "./cards";
import { db } from "./db";

/**
 * Catalogue reads. Plain async functions with no Next.js cache calls, so integration tests can call them
 * directly; lib/data/repo.ts wraps the ones pages use with "use cache".
 */

export const PAGE_SIZE = 24;

const placeSelect = {
  slug: true,
  name: true,
  country: true,
  tagline: true,
  imageUrl: true,
  altitudeM: true,
  inseeCode: true,
} satisfies Prisma.PlaceSelect;
const toPlace = (p: Prisma.PlaceGetPayload<{ select: typeof placeSelect }>): Place => ({
  slug: p.slug,
  name: p.name,
  country: p.country,
  tagline: p.tagline,
  image: p.imageUrl,
  altitudeM: p.altitudeM,
  inseeCode: p.inseeCode,
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

/** Resolve a URL segment ("les-orres", "Orcières-Merlette 1850", "Les Orres") to a known place. */
export async function findPlace(segment: string): Promise<Place | null> {
  const s = slugify(decodeURIComponent(segment));
  if (!s) return null;
  const row = await db.place.findFirst({ where: { OR: [{ slug: s }, { searchName: s }] }, select: placeSelect });
  return row && toPlace(row);
}

export type HomeSection =
  | { kind: "resorts"; title: string; places: Place[] }
  | { kind: "listings"; title: string; href: string; cards: CardData[] };

/** Smallest party the "Grands logements pour les familles" row is about. */
export const FAMILY_MIN_GUESTS = 6;

async function homesRow(title: string, href: string, where: Prisma.ListingWhereInput): Promise<HomeSection> {
  const rows = await db.listing.findMany({ where: { category: "HOME", ...where }, select: cardSelect, orderBy: bestFirst, take: 14 });
  return { kind: "listings", title, href, cards: rows.map((l) => toCard(l)) };
}

/**
 * Homepage: the resorts, then the best homes of each resort, the "Ski aux pieds" homes and the large ones for
 * families. Undated (nightly prices): the season is ahead, so no row claims availability for given dates.
 */
export async function homeSections(): Promise<HomeSection[]> {
  const places = await listPlaces();
  const rows = await Promise.all([
    ...places.map((p) => homesRow(`Logements populaires · ${p.name}`, searchHref(p.slug, {}), { place: { slug: p.slug } })),
    homesRow("Ski aux pieds", searchHref(ANYWHERE, { ski: true }), { liftDistanceM: { lte: SKI_IN_MAX_M } }),
    homesRow("Grands logements pour les familles", searchHref(ANYWHERE, { adults: FAMILY_MIN_GUESTS }), {
      maxGuests: { gte: FAMILY_MIN_GUESTS },
    }),
  ]);
  return [{ kind: "resorts", title: "Nos deux stations", places }, ...rows.filter((s) => s.kind !== "listings" || s.cards.length > 0)];
}

/** Homes free on the dates and bookable for that many nights (minimum stay). */
function bookableBetween(checkin: Date, checkout: Date): Prisma.ListingWhereInput {
  return { ...availableBetween(checkin, checkout), minNights: { lte: nightsBetween(checkin, checkout) } };
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
 * Homes for a destination segment and query: enough room for the guests, free on the dates and bookable
 * for that many nights, pet-friendly when pets come along, of the requested type, "Ski aux pieds" if asked. "partout" searches everywhere; any other unknown place has no results.
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
    ...(q.type && { propertyType: TYPE_FILTERS[q.type] }),
    ...(q.ski && { liftDistanceM: { lte: SKI_IN_MAX_M } }),
    ...(checkin && checkout && bookableBetween(checkin, checkout)),
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
  const opts = { checkin, checkout, guests: q, search: true };
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
  const rows = await db.listing.findMany({ where: { id: { in: ids }, category: "HOME" }, select: cardSelect });
  // Keep the caller's order (most recently saved first).
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => (byId.has(id) ? [toCard(byId.get(id)!)] : []));
}

/** Ids of every bookable home, for prerendering listing pages. */
export async function homeIds(): Promise<string[]> {
  const rows = await db.listing.findMany({ where: { category: "HOME" }, select: { id: true }, orderBy: { id: "asc" } });
  return rows.map((r) => r.id);
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
      stars: true,
      // Public by law: listings must display their registration number.
      registrationNumber: true,
      liftDistanceM: true,
      minNights: true,
      dpeClass: true,
      isGuestFavorite: true,
      ratingAvg: true,
      reviewCount: true,
      place: { select: placeSelect },
      // Not isFoundingHost: it reveals the owner's commission tier, which stays out of guest-facing data.
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

/** Confirmed stays overlapping [from, to), for calendars. Dates are yyyy-MM-dd, checkout exclusive. */
export async function bookedRanges(listingId: string, from: Date, to: Date) {
  const rows = await db.booking.findMany({
    where: { listingId, status: "CONFIRMED", checkIn: { lt: to }, checkOut: { gt: from } },
    select: { checkIn: true, checkOut: true },
    orderBy: { checkIn: "asc" },
  });
  return rows.map((r) => ({ checkIn: r.checkIn.toISOString().slice(0, 10), checkOut: r.checkOut.toISOString().slice(0, 10) }));
}

/** Every confirmed stay on a listing, for the iCal export; null when the listing doesn't exist. */
export async function confirmedStays(listingId: string) {
  const listing = await db.listing.findUnique({
    where: { id: listingId },
    select: {
      id: true,
      bookings: {
        where: { status: "CONFIRMED" },
        select: { id: true, checkIn: true, checkOut: true, createdAt: true },
        orderBy: { checkIn: "asc" },
      },
    },
  });
  return listing?.bookings ?? null;
}

/** Minimum stay of a listing; null when the listing doesn't exist. */
export async function listingMinNights(listingId: string): Promise<number | null> {
  const l = await db.listing.findUnique({ where: { id: listingId }, select: { minNights: true } });
  return l?.minNights ?? null;
}
