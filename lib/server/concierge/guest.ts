import "server-only";
import { requestReference } from "@/lib/concierge/catalog";
import { readServiceOptions } from "@/lib/concierge/form";
import { lineTotals } from "@/lib/concierge/pricing";
import { checkRequestTiming, parseRequestForm, type RequestErrorCode } from "@/lib/concierge/request";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { GuestLocale } from "@/lib/i18n/locales";
import { pickLocalized } from "@/lib/i18n/localized";
import { recordAudit } from "../audit";
import { db } from "../db";
import { resolveGuideLink } from "../guide/guest";
import { RateLimiter } from "../rate-limit";

/**
 * The conciergerie in the guest's welcome guide (Lot 4b): the request form's submission and the services' photos
 * (what the guide shows: guest-view.ts). No account: the guide link is the
 * key (lib/server/guide/guest.ts resolves it), and every read and write is bound to that link's booking and
 * organization. What a guest gets is built field by field here: the sale price, never the partner's price, the margin,
 * the partner's name or contacts, the team's note.
 *
 * Abuse: submissions are limited per client (RateLimiter, 10 per 10 minutes) and per stay (30 per hour), and a stay
 * holds at most MAX_OPEN_REQUESTS requests not answered yet (new or sent to the partner), checked in the database.
 */

export const MAX_OPEN_REQUESTS = 20;
export const guestRequestClientLimiter = new RateLimiter(10, 10 * 60_000);
export const guestRequestStayLimiter = new RateLimiter(30, 60 * 60_000);

export type GuestRequestResult =
  | { ok: true; id: string; reference: string }
  | { ok: false; code: "unavailable" | "rateLimited" | "tooMany" }
  | { ok: false; code: "form"; errors: Partial<Record<RequestErrorCode, true>>; leadTimeHours?: number };

const iso = (d: Date) => d.toISOString().slice(0, 10);

export interface GuestRequestContext {
  now?: Date;
  /** The client's address (rate limit); none = not limited per client. */
  client?: string;
  locale: GuestLocale;
}

/**
 * Creates a request from the guide whose link is `token`: the service must be an active one of the link's
 * organization, the options among its options, the date during the stay and at least the lead time away. The price
 * is snapshotted now (lib/concierge/pricing.ts); later catalogue changes don't alter it.
 */
export async function createGuestRequest(token: unknown, values: Record<string, string>, optionIds: readonly string[], ctx: GuestRequestContext): Promise<GuestRequestResult> {
  const now = ctx.now ?? new Date();
  if (ctx.client && !guestRequestClientLimiter.take(ctx.client, now.getTime())) return { ok: false, code: "rateLimited" };
  const resolved = await resolveGuideLink(token, now, ctx.client);
  if (!resolved) return { ok: false, code: "unavailable" };
  const { booking: b, link, window } = resolved;
  if (now.getTime() >= window.closesAt.getTime()) return { ok: false, code: "unavailable" };
  if (!guestRequestStayLimiter.take(b.id, now.getTime())) return { ok: false, code: "rateLimited" };

  const parsed = parseRequestForm(values, optionIds);
  if (!parsed.ok) return { ok: false, code: "form", errors: parsed.errors };
  const input = parsed.input;
  const service = await db.service.findFirst({
    where: { id: input.serviceId, organizationId: link.organizationId, active: true },
    select: { id: true, partnerId: true, category: true, title: true, pricingModel: true, salePriceCents: true, partnerPriceCents: true, options: true, leadTimeHours: true },
  });
  if (!service) return { ok: false, code: "form", errors: { service: true } };
  const all = readServiceOptions(service.options);
  const chosen = all.filter((o) => input.optionIds.includes(o.id));
  if (chosen.length !== input.optionIds.length) return { ok: false, code: "form", errors: { options: true } };
  const timing = checkRequestTiming({ day: input.day, minutes: input.minutes, checkIn: b.checkIn, checkOut: b.checkOut, leadTimeHours: service.leadTimeHours, now, timeZone: b.listing.place.timezone });
  if (!timing.ok) return { ok: false, code: "form", errors: { [timing.reason]: true }, leadTimeHours: service.leadTimeHours };

  // Per person: the count is the number of persons.
  const quantity = service.pricingModel === "PER_PERSON" ? input.persons : input.quantity;
  const { totals } = lineTotals({ pricingModel: service.pricingModel, unitSaleCents: service.salePriceCents, unitPartnerCents: service.partnerPriceCents, quantity, persons: input.persons, options: chosen });
  const title = pickLocalized(service.title, "fr")?.text ?? "";

  return db.$transaction(async (tx) => {
    // Serializes the stay's submissions, so the cap holds under concurrent posts.
    await tx.$queryRaw`SELECT 1 FROM "bookings" WHERE "id" = ${b.id} FOR UPDATE`;
    const open = await tx.serviceRequest.count({ where: { bookingId: b.id, organizationId: link.organizationId, status: { in: ["NEW", "SENT_TO_PARTNER"] } } });
    if (open >= MAX_OPEN_REQUESTS) return { ok: false as const, code: "tooMany" as const };
    const r = await tx.serviceRequest.create({
      data: {
        organizationId: link.organizationId,
        bookingId: b.id,
        serviceId: service.id,
        partnerId: service.partnerId,
        serviceDate: input.day,
        startMinutes: input.minutes,
        scheduledAt: timing.scheduledAt,
        quantity,
        persons: input.persons,
        titleSnapshot: title,
        category: service.category,
        pricingModel: service.pricingModel,
        options: chosen as unknown as Prisma.InputJsonArray,
        unitSaleCents: service.salePriceCents,
        unitPartnerCents: service.partnerPriceCents,
        saleTotalCents: totals?.saleTotalCents ?? null,
        partnerTotalCents: totals?.partnerTotalCents ?? null,
        marginCents: totals?.marginCents ?? null,
        guestNote: input.note,
        contactPhone: input.phone,
        guestLocale: ctx.locale,
      },
      select: { id: true },
    });
    await recordAudit(tx, {
      organizationId: link.organizationId,
      actorId: null,
      action: "service_request.created",
      targetType: "service_request",
      targetId: r.id,
      details: {
        bookingId: b.id,
        serviceId: service.id,
        serviceDate: iso(input.day),
        startMinutes: input.minutes,
        quantity,
        persons: input.persons,
        options: chosen.map((o) => o.id),
        saleTotalCents: totals?.saleTotalCents ?? null,
        partnerTotalCents: totals?.partnerTotalCents ?? null,
        marginCents: totals?.marginCents ?? null,
      },
    });
    return { ok: true as const, id: r.id, reference: requestReference(r.id) };
  });
}

/** A service photo for the holder of a working guide link: its storage key, or null. */
export async function guestServicePhoto(token: unknown, serviceId: string, now = new Date(), client?: string): Promise<string | null> {
  const resolved = await resolveGuideLink(token, now, client);
  if (!resolved) return null;
  const s = await db.service.findFirst({ where: { id: serviceId, organizationId: resolved.link.organizationId, active: true }, select: { photoKey: true } });
  return s?.photoKey ?? null;
}
