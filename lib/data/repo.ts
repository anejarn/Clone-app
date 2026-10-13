import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { getListing, homeIds, homeSections, listPlaces } from "@/lib/server/catalog";

export type { CardData } from "@/lib/server/cards";
export type { HomeSection } from "@/lib/server/catalog";

/** Cache tags: "listings" for catalogue edits and reviews, "availability" for bookings and cancellations. */
export const TAGS = { listings: "listings", availability: "availability" } as const;

export async function getHomeSections() {
  "use cache";
  cacheLife("hours");
  cacheTag(TAGS.listings);
  return homeSections();
}

export async function getPlaces() {
  "use cache";
  cacheLife("days");
  cacheTag(TAGS.listings);
  return listPlaces();
}

export async function getHomeIds() {
  "use cache";
  cacheLife("hours");
  cacheTag(TAGS.listings);
  return homeIds();
}

/**
 * Everything the listing page shows, or null for an unknown id. Dates become ISO strings so the cached value
 * is plain data. Availability is not part of it: the booking card fetches it live.
 */
export async function getListingDetail(id: string) {
  "use cache";
  cacheLife("hours");
  cacheTag(TAGS.listings);
  const l = await getListing(id);
  if (!l) return null;
  return {
    ...l,
    host: { ...l.host, createdAt: l.host.createdAt.toISOString() },
    amenities: l.amenities.map((a) => a.amenity),
    reviews: l.reviews.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
  };
}

export type ListingDetail = NonNullable<Awaited<ReturnType<typeof getListingDetail>>>;
