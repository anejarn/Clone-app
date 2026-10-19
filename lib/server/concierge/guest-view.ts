import "server-only";
import { requestReference } from "@/lib/concierge/catalog";
import { readServiceOptions } from "@/lib/concierge/form";
import { earliestDay } from "@/lib/concierge/request";
import { todayInTimeZone } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { ServiceCategory, ServicePricingModel, ServiceRequestStatus } from "@/lib/generated/prisma/enums";
import type { GuestLocale } from "@/lib/i18n/locales";
import { pickLocalized } from "@/lib/i18n/localized";
import { formatTimeOfDay } from "@/lib/operations/schedule";
import { db } from "../db";

/**
 * What the guest's welcome guide shows of the conciergerie (Lot 4b): the organization's active services in the guest's
 * language and the requests of this stay with their status, for a link already resolved by lib/server/guide/guest.ts.
 * Built field by field: the sale price, never the partner's price, the margin, the partner or the team's note.
 */

export interface GuestService {
  id: string;
  category: ServiceCategory;
  title: string;
  description: string | null;
  availability: string | null;
  pricingModel: ServicePricingModel;
  /** Sale price per unit of the pricing model; null on quote. */
  unitPriceCents: number | null;
  options: { id: string; label: string; priceCents: number; perUnit: boolean }[];
  leadTimeHours: number;
  hasPhoto: boolean;
}

export interface GuestServiceRequest {
  id: string;
  reference: string;
  title: string;
  status: ServiceRequestStatus;
  date: string;
  time: string;
  persons: number;
  quantity: number;
  pricingModel: ServicePricingModel;
  options: string[];
  /** What the guest pays; null while a quote is pending. */
  totalCents: number | null;
  paid: boolean;
}

export interface GuestConcierge {
  services: GuestService[];
  requests: GuestServiceRequest[];
  /** False once the stay is over: the form is not offered any more. */
  open: boolean;
  /** yyyy-MM-dd bounds of the date picker: the stay's first and last day, and the earliest day still possible. */
  stay: { firstDay: string; lastDay: string; from: string; to: string };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

const guestServiceSelect = {
  id: true,
  category: true,
  title: true,
  description: true,
  availability: true,
  pricingModel: true,
  salePriceCents: true,
  options: true,
  leadTimeHours: true,
  photoKey: true,
} satisfies Prisma.ServiceSelect;

function toGuestService(s: Prisma.ServiceGetPayload<{ select: typeof guestServiceSelect }>, locale: GuestLocale): GuestService {
  return {
    id: s.id,
    category: s.category,
    title: pickLocalized(s.title, locale)?.text ?? "",
    description: pickLocalized(s.description, locale)?.text ?? null,
    availability: pickLocalized(s.availability, locale)?.text ?? null,
    pricingModel: s.pricingModel,
    unitPriceCents: s.salePriceCents,
    options: readServiceOptions(s.options).map((o) => ({ id: o.id, label: pickLocalized(o.label, locale)?.text ?? "", priceCents: o.saleCents, perUnit: o.perUnit })),
    leadTimeHours: s.leadTimeHours,
    hasPhoto: !!s.photoKey,
  };
}

/** The services, requests and date bounds of a guide (called by getGuestGuide with the resolved link). */
export async function guestConcierge(
  link: { organizationId: string; bookingId: string },
  booking: { checkIn: Date; checkOut: Date; listing: { place: { timezone: string } } },
  locale: GuestLocale,
  opts: { now: Date; open: boolean },
): Promise<GuestConcierge> {
  const [services, requests] = await Promise.all([
    db.service.findMany({
      where: { organizationId: link.organizationId, active: true },
      select: guestServiceSelect,
      orderBy: [{ category: "asc" }, { position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      take: 100,
    }),
    db.serviceRequest.findMany({
      where: { organizationId: link.organizationId, bookingId: link.bookingId },
      select: {
        id: true,
        status: true,
        serviceDate: true,
        startMinutes: true,
        persons: true,
        quantity: true,
        pricingModel: true,
        options: true,
        titleSnapshot: true,
        saleTotalCents: true,
        paidAt: true,
        service: { select: { title: true } },
      },
      orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
      take: 50,
    }),
  ]);
  const localToday = todayInTimeZone(booking.listing.place.timezone, opts.now.getTime());
  return {
    services: services.map((s) => toGuestService(s, locale)).filter((s) => s.title),
    requests: requests.map((r) => ({
      id: r.id,
      reference: requestReference(r.id),
      title: pickLocalized(r.service.title, locale)?.text ?? r.titleSnapshot,
      status: r.status,
      date: formatDate(r.serviceDate),
      time: formatTimeOfDay(r.startMinutes),
      persons: r.persons,
      quantity: r.quantity,
      pricingModel: r.pricingModel,
      options: readServiceOptions(r.options).map((o) => pickLocalized(o.label, locale)?.text ?? ""),
      totalCents: r.saleTotalCents,
      paid: !!r.paidAt,
    })),
    open: opts.open,
    stay: {
      firstDay: iso(booking.checkIn),
      lastDay: iso(booking.checkOut),
      from: iso(earliestDay({ checkIn: booking.checkIn, leadTimeHours: 0, localToday })),
      to: iso(booking.checkOut),
    },
  };
}

