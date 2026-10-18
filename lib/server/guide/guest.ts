import "server-only";
import { formatDate } from "@/lib/format";
import { defaultMapsUrl, lines } from "@/lib/guide/form";
import { GUIDE_TOKEN_RE, hashGuideToken } from "@/lib/guide/token";
import { accessState, accessWindow, guideLinkAlive, type AccessState } from "@/lib/guide/window";
import type { GuideAccessCodeKind, GuideRecommendationCategory } from "@/lib/generated/prisma/enums";
import { localeDir, negotiateLocale, type GuestLocale } from "@/lib/i18n/locales";
import { pickLocalized, readLocalized } from "@/lib/i18n/localized";
import { formatTimeOfDay, localDayAndMinutes, stayTimes } from "@/lib/operations/schedule";
import { decryptSecret, SecretDecryptError, type SecretContext } from "@/lib/secrets/access-codes";
import { db } from "../db";
import { FailureLimiter } from "../rate-limit";

/**
 * The guest's welcome guide, /guide/<token> (Lot 4a). No account: the secret link is the key. The token is looked
 * up by its SHA-256 (guide_links.tokenHash, unique index); an unknown, malformed, revoked or replaced token, a
 * cancelled stay, an owner block, or a link more than 30 days past the stay all answer null (the page: « introuvable »).
 *
 * What the guest gets is built here and only here, field by field: the home's name, neighbourhood and address, the
 * stay's dates and times, the guest's first name, the guide's texts in their language, photos (by id), Wi-Fi, house
 * rules, recommendations and the conciergerie's contact. Never an amount, a note, the guest's contact, another
 * guest, the owner or anything internal. The access codes and the Wi-Fi password are decrypted only while the stay
 * is OPEN (check-in time on arrival day → check-out time on departure day, lib/guide/window.ts).
 */

export interface GuestGuide {
  locale: GuestLocale;
  dir: "ltr" | "rtl";
  guestFirstName: string | null;
  listing: { title: string; placeName: string; address: string; city: string; mapsUrl: string };
  stay: { checkIn: string; checkOut: string; arrivalTime: string; departureTime: string };
  access: { state: AccessState; opensAt: string; closesAt: string; opensDate: string; opensTime: string };
  directions: string | null;
  accessInstructions: string | null;
  photos: { id: string; caption: string }[];
  wifi: { name: string | null; configured: boolean; password: string | null };
  /** OPEN only; otherwise null (hasCodes says whether there are any). */
  codes: { kind: GuideAccessCodeKind; label: string; value: string }[] | null;
  hasCodes: boolean;
  houseRules: string[];
  recommendations: { category: GuideRecommendationCategory; name: string; description: string | null; url: string | null }[];
  concierge: { phone: string | null; whatsapp: string | null };
}

/** Failed lookups per client: 30 in 10 minutes, then the client's lookups are refused until the window ends. */
export const guideLookupLimiter = new FailureLimiter(30, 10 * 60_000);

const linkSelect = {
  bookingId: true,
  organizationId: true,
  revokedAt: true,
  booking: {
    select: {
      id: true,
      status: true,
      source: true,
      checkIn: true,
      checkOut: true,
      guestName: true,
      guestLocale: true,
      guest: { select: { name: true } },
      listing: {
        select: {
          id: true,
          title: true,
          address: true,
          city: true,
          lat: true,
          lng: true,
          houseRules: true,
          checkInMinutes: true,
          checkOutMinutes: true,
          place: { select: { name: true, timezone: true } },
          organization: { select: { checkInMinutes: true, checkOutMinutes: true, conciergePhone: true, conciergeWhatsapp: true } },
        },
      },
    },
  },
} as const;

/**
 * The link and its stay, when the token opens a guide at `now`; null otherwise. With `client`, failed lookups count
 * against it and a client over the limit gets null without a lookup.
 */
export async function resolveGuideLink(token: unknown, now: Date, client?: string) {
  if (client && guideLookupLimiter.blocked(client, now.getTime())) return null;
  const fail = () => {
    if (client) guideLookupLimiter.fail(client, now.getTime());
    return null;
  };
  if (typeof token !== "string" || !GUIDE_TOKEN_RE.test(token)) return fail();
  const link = await db.guideLink.findUnique({ where: { tokenHash: hashGuideToken(token) }, select: linkSelect });
  if (!link || link.revokedAt) return fail();
  const b = link.booking;
  // A cancelled stay or an owner block has no guide (the trigger already refuses links on owner blocks).
  if (b.status !== "CONFIRMED" || b.source === "OWNER") return null;
  const times = stayTimes(b.listing.organization, b.listing);
  const window = accessWindow(b, times, b.listing.place.timezone);
  if (!guideLinkAlive(window, now)) return null;
  return { link, booking: b, times, window };
}

function firstName(b: { guestName: string | null; guest: { name: string } | null }): string | null {
  const full = (b.guest?.name ?? b.guestName ?? "").trim();
  return full ? full.split(/\s+/)[0] : null;
}

function open(envelope: string, ctx: SecretContext): string | null {
  try {
    return decryptSecret(envelope, ctx);
  } catch (e) {
    if (e instanceof SecretDecryptError) {
      console.error(`guide secret of listing ${ctx.listingId} unreadable: ${e.message}`);
      return null;
    }
    throw e;
  }
}

export interface GuideRequest {
  /** The ?lang= of the page. */
  lang?: string | string[] | null;
  acceptLanguage?: string | null;
  /** The client, for the failed-lookup limiter. */
  client?: string;
  /** Injected in tests; the page uses the current time. */
  now?: Date;
}

export async function getGuestGuide(token: unknown, req: GuideRequest = {}): Promise<GuestGuide | null> {
  const now = req.now ?? new Date();
  const resolved = await resolveGuideLink(token, now, req.client);
  if (!resolved) return null;
  const { booking: b, times, window } = resolved;
  const l = b.listing;
  const organizationId = resolved.link.organizationId;
  const locale = negotiateLocale({ query: req.lang, preferred: b.guestLocale, acceptLanguage: req.acceptLanguage });
  const state = accessState(window, now);

  const [guide, photos, codes, recos] = await Promise.all([
    db.listingGuide.findUnique({ where: { listingId: l.id } }),
    db.guidePhoto.findMany({ where: { listingId: l.id, organizationId }, select: { id: true, caption: true }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
    db.guideAccessCode.findMany({ where: { listingId: l.id, organizationId }, select: { kind: true, label: true, valueEnc: true }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
    db.guideRecommendation.findMany({ where: { organizationId, listingId: l.id }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
  ]);
  const orgRecos =
    (guide?.useOrgRecommendations ?? true)
      ? await db.guideRecommendation.findMany({ where: { organizationId, listingId: null }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] })
      : [];

  const ctx = (purpose: "access-code" | "wifi"): SecretContext => ({ organizationId, listingId: l.id, purpose });
  const isOpen = state === "OPEN";
  const rulesText = locale === "fr" ? l.houseRules : (readLocalized(guide?.houseRulesTranslations)[locale] ?? l.houseRules);
  const opens = localDayAndMinutes(window.opensAt, l.place.timezone);

  return {
    locale,
    dir: localeDir(locale),
    guestFirstName: firstName(b),
    listing: { title: l.title, placeName: l.place.name, address: l.address, city: l.city, mapsUrl: guide?.mapsUrl ?? defaultMapsUrl(l.lat, l.lng) },
    stay: {
      checkIn: formatDate(b.checkIn),
      checkOut: formatDate(b.checkOut),
      arrivalTime: formatTimeOfDay(times.checkInMinutes),
      departureTime: formatTimeOfDay(times.checkOutMinutes),
    },
    access: {
      state,
      opensAt: window.opensAt.toISOString(),
      closesAt: window.closesAt.toISOString(),
      opensDate: formatDate(opens.day),
      opensTime: formatTimeOfDay(opens.minutes),
    },
    directions: pickLocalized(guide?.directions, locale)?.text ?? null,
    accessInstructions: pickLocalized(guide?.accessInstructions, locale)?.text ?? null,
    photos,
    wifi: {
      name: guide?.wifiName ?? null,
      configured: !!(guide?.wifiName || guide?.wifiPasswordEnc),
      password: isOpen && guide?.wifiPasswordEnc ? open(guide.wifiPasswordEnc, ctx("wifi")) : null,
    },
    codes: isOpen
      ? codes.flatMap((c) => {
          const value = open(c.valueEnc, ctx("access-code"));
          return value === null ? [] : [{ kind: c.kind, label: c.label, value }];
        })
      : null,
    hasCodes: codes.length > 0,
    houseRules: lines(rulesText),
    recommendations: [...recos, ...orgRecos].map((r) => ({
      category: r.category,
      name: r.name,
      description: pickLocalized(r.description, locale)?.text ?? null,
      url: r.url,
    })),
    concierge: { phone: l.organization.conciergePhone, whatsapp: l.organization.conciergeWhatsapp },
  };
}

/** A guide photo for the holder of a working link: its storage key, or null. */
export async function guestGuidePhoto(token: unknown, photoId: string, now = new Date(), client?: string): Promise<string | null> {
  const resolved = await resolveGuideLink(token, now, client);
  if (!resolved) return null;
  const p = await db.guidePhoto.findFirst({
    where: { id: photoId, listingId: resolved.booking.listing.id, organizationId: resolved.link.organizationId },
    select: { storageKey: true },
  });
  return p?.storageKey ?? null;
}
