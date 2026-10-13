import type { Prisma } from "@/lib/generated/prisma/client";
import { formatDateRange, formatEuros, formatPrice } from "@/lib/format";
import { classificationLabel, liftDistanceLabel, MIN_REVIEWS_FOR_RATING, PROPERTY_TYPE_LABEL } from "@/lib/labels";
import { nightsBetween, priceStay } from "@/lib/pricing";
import { toISODate, toSearchParams, type GuestCounts } from "@/lib/search/params";

/** Everything a ListingCard renders, precomputed on the server. */
export interface CardData {
  id: string;
  href: string;
  /** The listing's own title: the card's heading and accessible name. */
  title: string;
  /** "Appartement · Les Orres" */
  kind: string;
  /** "Meublé 3★ · Ski aux pieds", "Non classé · À 350 m des pistes · 3 nuits min." */
  facts: string;
  /** "8–10 janv.", omitted without dates */
  subtitle?: string;
  /** "Particulier" / "Professionnel" */
  hostKind?: string;
  price: string;
  priceSuffix: string;
  /** Average shown once a listing has MIN_REVIEWS_FOR_RATING reviews; before that the card says "Nouveau". */
  rating: number | null;
  isNew: boolean;
  badge?: string;
  photos: string[];
  pinned?: boolean;
  /** "Meublé de tourisme" stars, null when unclassified. */
  stars: number | null;
  /** Metres to the nearest lift ("Ski aux pieds" up to 50). */
  liftDistanceM: number;
  minNights: number;
}

export const cardSelect = {
  id: true,
  propertyType: true,
  title: true,
  priceCents: true,
  cleaningFeeCents: true,
  ratingAvg: true,
  reviewCount: true,
  isGuestFavorite: true,
  stars: true,
  liftDistanceM: true,
  minNights: true,
  place: { select: { name: true, slug: true, inseeCode: true } },
  host: { select: { isProfessional: true, isFoundingHost: true } },
  photos: { select: { url: true }, orderBy: { position: "asc" }, take: 5 },
} satisfies Prisma.ListingSelect;

export type CardRow = Prisma.ListingGetPayload<{ select: typeof cardSelect }>;

export function searchHref(placeSlug: string, q: Parameters<typeof toSearchParams>[0]): string {
  const qs = toSearchParams(q).toString();
  return `/s/${placeSlug}/homes${qs ? `?${qs}` : ""}`;
}

/** Listing page, carrying the searched dates and guests over to its booking card. */
export function roomHref(id: string, q: Parameters<typeof toSearchParams>[0] = {}): string {
  const qs = toSearchParams({ checkin: q.checkin, checkout: q.checkout, adults: q.adults, children: q.children, infants: q.infants, pets: q.pets }).toString();
  return `/rooms/${id}${qs ? `?${qs}` : ""}`;
}

/**
 * With dates, the price is the all-in guest total (stay + cleaning + taxe de séjour, no service fee) for the
 * searched guests; without guests it is priced for one adult. Without dates it is the nightly price.
 */
export function toCard(
  l: CardRow,
  opts: { checkin?: Date; checkout?: Date; guests?: GuestCounts; search?: boolean; pinned?: boolean } = {},
): CardData {
  const hasRating = l.reviewCount >= MIN_REVIEWS_FOR_RATING && l.ratingAvg !== null;
  const { checkin, checkout, guests } = opts;
  const nights = checkin && checkout ? nightsBetween(checkin, checkout) : 0;
  const type = l.propertyType ? PROPERTY_TYPE_LABEL[l.propertyType] : "Logement";
  const total =
    checkin && nights
      ? priceStay({
          nightlyCents: l.priceCents,
          cleaningFeeCents: l.cleaningFeeCents,
          nights,
          checkIn: checkin,
          inseeCode: l.place.inseeCode,
          stars: l.stars,
          isFoundingHost: l.host.isFoundingHost,
          adults: Math.max(1, guests?.adults ?? 0),
          children: guests?.children ?? 0,
          infants: guests?.infants ?? 0,
        }).guest.totalCents
      : 0;
  return {
    id: l.id,
    photos: l.photos.map((p) => p.url),
    rating: hasRating ? l.ratingAvg : null,
    isNew: !hasRating,
    badge: l.isGuestFavorite ? "Coup de cœur voyageurs" : undefined,
    pinned: opts.pinned,
    stars: l.stars,
    liftDistanceM: l.liftDistanceM,
    minNights: l.minNights,
    href: roomHref(l.id, { checkin: checkin && toISODate(checkin), checkout: checkout && toISODate(checkout), ...guests }),
    title: l.title,
    kind: `${type} · ${l.place.name}`,
    facts: [classificationLabel(l.stars), liftDistanceLabel(l.liftDistanceM), l.minNights > 2 ? `${l.minNights}\u00a0nuits min.` : null]
      .filter(Boolean)
      .join(" · "),
    subtitle: checkin && checkout ? formatDateRange(checkin, checkout) : undefined,
    hostKind: l.host.isProfessional ? "Professionnel" : "Particulier",
    // The all-in total to the cent, exactly what the booking charges; the nightly price is in whole euros.
    price: nights ? formatPrice(total) : formatEuros(l.priceCents),
    priceSuffix: nights ? (opts.search ? `pour ${nights} nuit${nights > 1 ? "s" : ""}` : "au total") : "par nuit",
  };
}
