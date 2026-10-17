import type { Prisma } from "@/lib/generated/prisma/client";
import { formatDateRange, formatPrice } from "@/lib/format";
import { MIN_REVIEWS_FOR_RATING, PROPERTY_TYPE_LABEL } from "@/lib/labels";
import { nightsBetween, stayTotal } from "@/lib/pricing";
import { toISODate, toSearchParams } from "@/lib/search/params";

/** Everything a ListingCard renders, precomputed on the server. */
export interface CardData {
  id: string;
  href: string;
  title: string;
  /** "8–10 janv." / place name for experiences, omitted when unknown */
  subtitle?: string;
  /** "Particulier" / "Professionnel" */
  hostKind?: string;
  price: string;
  priceSuffix: string;
  /** Average shown once a listing has MIN_REVIEWS_FOR_RATING reviews; before that the card says "Note à venir". */
  rating: number | null;
  isNew: boolean;
  badge?: string;
  photos: string[];
  pinned?: boolean;
}

export const cardSelect = {
  id: true,
  category: true,
  propertyType: true,
  title: true,
  priceCents: true,
  cleaningFeeCents: true,
  ratingAvg: true,
  reviewCount: true,
  isGuestFavorite: true,
  place: { select: { name: true, slug: true } },
  host: { select: { isProfessional: true } },
  photos: { select: { url: true }, orderBy: { position: "asc" }, take: 5 },
} satisfies Prisma.ListingSelect;

export type CardRow = Prisma.ListingGetPayload<{ select: typeof cardSelect }>;

/** Shown on listings Sigma flags as a pick (`isGuestFavorite`). */
export const FEATURED_BADGE = "Sélection Sigma";

export function searchHref(placeSlug: string, q: Parameters<typeof toSearchParams>[0]): string {
  const qs = toSearchParams(q).toString();
  return `/s/${placeSlug}/homes${qs ? `?${qs}` : ""}`;
}

export function toCard(
  l: CardRow,
  opts: { checkin?: Date; checkout?: Date; pinned?: boolean } = {},
): CardData {
  const hasRating = l.reviewCount >= MIN_REVIEWS_FOR_RATING && l.ratingAvg !== null;
  const common = {
    id: l.id,
    photos: l.photos.map((p) => p.url),
    rating: hasRating ? l.ratingAvg : null,
    isNew: !hasRating,
    badge: l.isGuestFavorite ? FEATURED_BADGE : undefined,
    pinned: opts.pinned,
  };
  if (l.category === "EXPERIENCE") {
    return {
      ...common,
      href: searchHref(l.place.slug, { pinned: l.id }),
      title: l.title,
      subtitle: l.place.name,
      price: `Dès ${formatPrice(l.priceCents)}`,
      priceSuffix: "par personne",
    };
  }
  const { checkin, checkout } = opts;
  const nights = checkin && checkout ? nightsBetween(checkin, checkout) : 0;
  const type = l.propertyType ? PROPERTY_TYPE_LABEL[l.propertyType] : "Logement";
  return {
    ...common,
    href: searchHref(l.place.slug, {
      pinned: l.id,
      checkin: checkin && toISODate(checkin),
      checkout: checkout && toISODate(checkout),
    }),
    title: `${type} · ${l.place.name}`,
    subtitle: checkin && checkout ? formatDateRange(checkin, checkout) : undefined,
    hostKind: l.host.isProfessional ? "Professionnel" : "Particulier",
    price: formatPrice(nights ? stayTotal(l.priceCents, nights, l.cleaningFeeCents) : l.priceCents),
    priceSuffix: nights ? `pour ${nights} nuit${nights > 1 ? "s" : ""}` : "la nuit",
  };
}
