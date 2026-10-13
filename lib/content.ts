import { toSearchParams, type SearchQuery } from "@/lib/search/params";
import type { InspirationGroup } from "@/lib/types";

/**
 * Editorial content: changes with releases, not with bookings, so it lives in code rather than the database.
 * The launch has two resorts; their slugs and names match prisma/fixtures.ts.
 */
export const RESORTS = [
  { slug: "orcieres-merlette", name: "Orcières-Merlette 1850" },
  { slug: "les-orres", name: "Les Orres" },
] as const;

const search = (slug: string, q: Partial<SearchQuery>) => {
  const qs = toSearchParams(q).toString();
  return `/s/${slug}/homes${qs ? `?${qs}` : ""}`;
};

/** "Trouver un logement par station": one tab per resort, each link a search. */
export const inspiration: InspirationGroup[] = RESORTS.map(({ slug, name }) => ({
  label: name,
  links: [
    { label: "Studios", href: search(slug, { type: "studio" }) },
    { label: "Appartements", href: search(slug, { type: "appartement" }) },
    { label: "Chalets", href: search(slug, { type: "chalet" }) },
    { label: "Ski aux pieds", href: search(slug, { ski: true }) },
    { label: "6 voyageurs et plus", href: search(slug, { adults: 6 }) },
    { label: "Animaux acceptés", href: search(slug, { adults: 1, pets: 1 }) },
  ],
}));
