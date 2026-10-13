import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { homeSections, type HomeCategory } from "@/lib/server/catalog";

export type { CardData } from "@/lib/server/cards";
export type { HomeCategory, HomeSection } from "@/lib/server/catalog";

/** Cache tags: "listings" for catalogue edits and reviews, "availability" for bookings and cancellations. */
export const TAGS = { listings: "listings", availability: "availability" } as const;

export async function getHomeSections(category: HomeCategory) {
  "use cache";
  cacheLife("hours");
  cacheTag(TAGS.listings, TAGS.availability);
  return homeSections(category, Date.now());
}
