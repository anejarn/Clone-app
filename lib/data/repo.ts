import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { homeSections, type HomeCategory } from "@/lib/server/catalog";
import { publicOrgId } from "@/lib/server/org";

export type { CardData } from "@/lib/server/cards";
export type { HomeCategory, HomeSection } from "@/lib/server/catalog";

/** Cache tags: "listings" for catalogue edits and reviews, "availability" for bookings and cancellations. */
export const TAGS = { listings: "listings", availability: "availability" } as const;

/** The public organization's homepage rows. Its id is resolved inside the cached scope, so prerendering stays static. */
export async function getHomeSections(category: HomeCategory) {
  "use cache";
  cacheLife("hours");
  cacheTag(TAGS.listings, TAGS.availability);
  return homeSections(await publicOrgId(), category, Date.now());
}
