import { cacheLife } from "next/cache";
import { inspiration, listings, places, services } from "@/lib/data/seed";
import { formatDateRange, formatEuros } from "@/lib/format";
import { nightsBetween, stayTotal } from "@/lib/pricing";
import { ANYWHERE, fromISODate, slugify, toSearchParams, totalGuests, type SearchQuery } from "@/lib/search/params";
import type { Listing, Place } from "@/lib/types";

/** Everything a ListingCard renders, precomputed on the server. */
export interface CardData {
  id: string;
  href: string;
  title: string;
  /** "8–10 janv." / "2 h", omitted when unknown */
  subtitle?: string;
  /** "Particulier" / "Professionnel" */
  hostKind?: string;
  price: string;
  /** Search pages bold the amount and show "pour N nuits". */
  priceSuffix: string;
  rating: number | null;
  badge?: string;
  photos: string[];
  pinned?: boolean;
}

export type HomeSection =
  | { kind: "destinations"; title: string; places: Place[] }
  | { kind: "services"; title: string; services: typeof services }
  | { kind: "listings"; title: string; href: string; cards: CardData[] };

export type HomeCategory = "all" | "homes" | "experiences" | "services";

const DAY = 86_400_000;

function utcMidnight(ms: number): Date {
  const d = new Date(ms);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Next Friday→Sunday window starting at least `weeksAhead` weeks from `now`. */
function weekend(now: number, weeksAhead: number): [Date, Date] {
  const today = utcMidnight(now);
  const toFriday = (5 - today.getUTCDay() + 7) % 7 || 7;
  const start = new Date(today.getTime() + (toFriday + 7 * weeksAhead) * DAY);
  return [start, new Date(start.getTime() + 2 * DAY)];
}

function searchHref(placeSlug: string, q: Partial<SearchQuery>): string {
  const qs = toSearchParams(q).toString();
  return `/s/${placeSlug}/homes${qs ? `?${qs}` : ""}`;
}

function toCard(l: Listing, opts: { checkin?: Date; checkout?: Date; search?: boolean; pinned?: boolean } = {}): CardData {
  const common = {
    id: l.id,
    photos: l.photos,
    rating: l.rating,
    badge: l.isGuestFavorite ? "Coup de cœur voyageurs" : undefined,
    pinned: opts.pinned,
  };
  if (l.category === "experience") {
    return {
      ...common,
      href: searchHref(l.placeSlug, { pinned: l.id }),
      title: l.type,
      subtitle: l.placeName,
      price: `À partir de ${formatEuros(l.price)}`,
      priceSuffix: "/ voyageur",
    };
  }
  const { checkin, checkout } = opts;
  const nights = checkin && checkout ? nightsBetween(checkin, checkout) : 0;
  const iso = (d?: Date) => d?.toISOString().slice(0, 10);
  return {
    ...common,
    href: searchHref(l.placeSlug, { pinned: l.id, checkin: iso(checkin), checkout: iso(checkout) }),
    title: `${l.type} · ${l.placeName}`,
    subtitle: checkin && checkout ? formatDateRange(checkin, checkout) : undefined,
    hostKind: l.isProfessionalHost ? "Professionnel" : "Particulier",
    price: nights ? formatEuros(stayTotal(l.price, nights, l.cleaningFee)) : formatEuros(l.price),
    priceSuffix: nights ? (opts.search ? `pour ${nights} nuit${nights > 1 ? "s" : ""}` : "au total") : "par nuit",
  };
}

const homesIn = (slug: string) => listings.filter((l) => l.category === "home" && l.placeSlug === slug);
const experiencesIn = (slugs: string[]) =>
  listings.filter((l) => l.category === "experience" && slugs.includes(l.placeSlug));

export async function getHomeSections(category: HomeCategory): Promise<HomeSection[]> {
  "use cache";
  // Card dates are relative to "now", so refresh daily.
  cacheLife("days");
  const now = Date.now();

  const listingSection = (title: string, slug: string, weeksAhead: number, filter?: (l: Listing) => boolean): HomeSection => {
    const [checkin, checkout] = weekend(now, weeksAhead);
    const pool = homesIn(slug).filter(filter ?? (() => true));
    return {
      kind: "listings",
      title,
      href: searchHref(slug, {}),
      cards: pool.map((l, i) => {
        // Stagger dates a little so a row doesn't repeat the same weekend.
        const shift = (i % 3) * 7 * DAY;
        return toCard(l, { checkin: new Date(checkin.getTime() + shift), checkout: new Date(checkout.getTime() + shift) });
      }),
    };
  };
  const destinations: HomeSection = { kind: "destinations", title: "Destinations pour vous", places };
  const servicesSection: HomeSection = { kind: "services", title: "Trouvez des services à proximité", services };
  const experiences: HomeSection = {
    kind: "listings",
    title: "Expériences populaires · France",
    href: searchHref("paris", {}),
    cards: experiencesIn(["paris", "lyon", "marseille", "bordeaux", "nice", "annecy"]).map((l) => toCard(l)),
  };

  switch (category) {
    case "homes":
      return [
        listingSection("Logements populaires · Paris", "paris", 0),
        listingSection("Logements disponibles ce week-end · Marseille", "marseille", 0),
        listingSection("Chalets et appartements · Chamonix-Mont-Blanc", "chamonix", 1),
        listingSection("Logements · Lisbonne", "lisbonne", 2),
        listingSection("De superbes hôtels pour votre prochain voyage", "paris", 1, (l) => l.type === "Hôtel" || l.type === "Chambre"),
      ].filter((s) => s.kind !== "listings" || s.cards.length > 0);
    case "experiences":
      return [experiences, { ...experiences, title: "Expériences · Voyage à l'étranger", cards: experiencesIn(["lisbonne", "barcelone", "rome", "marrakech", "londres"]).map((l) => toCard(l)) }];
    case "services":
      return [servicesSection, destinations];
    default:
      return [
        destinations,
        servicesSection,
        listingSection("Logements populaires · Paris", "paris", 0),
        listingSection("Logements disponibles le mois prochain · Nice", "nice", 4),
        experiences,
        listingSection("Logements · Biarritz", "biarritz", 1),
      ];
  }
}

export function getPlaces(): Place[] {
  return places;
}

export function getInspiration() {
  return inspiration;
}

/** Resolve a URL segment ("paris", "Paris", "chamonix-mont-blanc") to a place, if we know it. */
export function findPlace(segment: string): Place | undefined {
  const s = slugify(decodeURIComponent(segment));
  return places.find((p) => p.slug === s || slugify(p.name) === s);
}

export interface SearchResult {
  place?: Place;
  label: string;
  cards: CardData[];
  nights: number;
}

export async function searchHomes(segment: string, q: SearchQuery): Promise<SearchResult> {
  "use cache";
  cacheLife("hours");
  const place = findPlace(segment);
  // "partout" means anywhere; any other unknown place has no listings.
  const anywhere = segment === ANYWHERE;
  const checkin = q.checkin ? fromISODate(q.checkin) : undefined;
  const checkout = q.checkout ? fromISODate(q.checkout) : undefined;
  const guests = totalGuests(q);
  const pool = listings.filter(
    (l) => l.category === "home" && (anywhere || l.placeSlug === place?.slug) && l.maxGuests >= guests,
  );
  // The pinned listing (clicked from the homepage) leads the results, like the original.
  pool.sort((a, b) => Number(b.id === q.pinned) - Number(a.id === q.pinned));
  return {
    place,
    label: place?.name ?? (anywhere ? "" : decodeURIComponent(segment)),
    nights: checkin && checkout ? nightsBetween(checkin, checkout) : 0,
    cards: pool.map((l) => toCard(l, { checkin, checkout, search: true, pinned: l.id === q.pinned })),
  };
}

export function listingsByIds(ids: string[]): CardData[] {
  return listings.filter((l) => ids.includes(l.id)).map((l) => toCard(l));
}

export function isHomeCategory(c: string): c is HomeCategory {
  return ["all", "homes", "experiences", "services"].includes(c);
}

