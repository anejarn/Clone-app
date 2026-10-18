import "server-only";
import { directAmounts, ENTRY_LIMITS, platformAmounts, rescheduledAmounts, type BookingEntry, type Reschedule } from "@/lib/admin/booking-form";
import { SOURCE_LABEL } from "@/lib/admin/booking-sources";
import { addDays, isoDay } from "@/lib/admin/calendar";
import { todayInTimeZone } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import { Prisma } from "@/lib/generated/prisma/client";
import type { BookingChannel, BookingSource, BookingStatus } from "@/lib/generated/prisma/enums";
import { MARRAKECH_TIMEZONE } from "@/lib/neighbourhoods";
import { syncBookingTasks } from "@/lib/operations/sync";
import { effectiveMinNights, nightsBetween, type PricingRule } from "@/lib/pricing";
import { minNightsMessage } from "../bookings";
import { recordAudit } from "../audit";
import type { Authorized } from "../authz";
import { db } from "../db";
import { AppError } from "../errors";
import { pricingRules } from "../pricing";
import { refreshExistingBookingTax } from "../declarations/tax";

/**
 * Bookings in the back-office (Calendrier, Réservations): what the team reads, and what associés type by hand.
 * Every function takes the caller's organization (from lib/server/authz.ts) and only reads or writes its rows: a
 * listing or booking id of another organization is answered 404, as an unknown one.
 *
 * - Reading (ADMIN and AGENT): every source, guest name and contacts (staff need them to welcome the guest);
 *   amounts only when `showAmounts` (ADMIN, lib/admin/sections.ts canSeeBookingAmounts): an agent's views have no
 *   `amounts` key at all, so nothing reaches their browser.
 * - Writing (ADMIN): a direct booking, a platform booking typed by hand, an owner block; new dates; cancellation.
 *   Overlaps are refused with the booking they hit (friendly pre-check in the transaction) and, under concurrent
 *   writes, by the database (exclusion constraint bookings_no_overlap). Each write is audited in its transaction.
 */

const bookingNotFound = () => new AppError(404, "NOT_FOUND", "Réservation introuvable.");
const listingNotFound = () => new AppError(404, "NOT_FOUND", "Bien introuvable.");

export const STAFF_BOOKINGS_PAGE_SIZE = 50;

const staffSelect = {
  id: true,
  listingId: true,
  source: true,
  status: true,
  checkIn: true,
  checkOut: true,
  externalRef: true,
  guestName: true,
  guestEmail: true,
  guestPhone: true,
  adults: true,
  children: true,
  infants: true,
  pets: true,
  channel: true,
  note: true,
  nightlyCents: true,
  cleaningFeeCents: true,
  totalCents: true,
  platformAmountCents: true,
  platformCurrency: true,
  platformAmountKind: true,
  createdAt: true,
  cancelledAt: true,
  guest: { select: { name: true, email: true, phone: true } },
  listing: { select: { title: true, place: { select: { name: true } } } },
} satisfies Prisma.BookingSelect;

type StaffRow = Prisma.BookingGetPayload<{ select: typeof staffSelect }>;

export interface BookingAmountsView {
  nightlyCents: number;
  cleaningFeeCents: number;
  totalCents: number;
}

/** A booking as the team sees it. Dates as yyyy-MM-dd; serializable, so it can be handed to client components. */
export interface StaffBookingView {
  id: string;
  listingId: string;
  listingTitle: string;
  placeName: string;
  source: BookingSource;
  status: BookingStatus;
  checkIn: string;
  checkOut: string;
  nights: number;
  externalRef: string | null;
  /** The account's name for a site booking, else the contact typed or imported. Null for owner blocks. */
  guestName: string | null;
  guestPhone: string | null;
  guestEmail: string | null;
  /** Booked from the site with a guest account. */
  hasGuestAccount: boolean;
  adults: number;
  children: number;
  infants: number;
  pets: number;
  channel: BookingChannel | null;
  note: string | null;
  createdAt: string;
  cancelledAt: string | null;
  /**
   * ADMIN only: absent for agents. Null when the amount isn't known (owner blocks, platform bookings whose amount
   * hasn't come yet).
   */
  amounts?: BookingAmountsView | null;
  /** ADMIN only: the amount the platform's e-mail gave, in its currency (lot 7b). */
  platformAmount?: { cents: number; currency: string; kind: "PAYOUT" | "GUEST_TOTAL" } | null;
}

function toView(b: StaffRow, showAmounts: boolean): StaffBookingView {
  const view: StaffBookingView = {
    id: b.id,
    listingId: b.listingId,
    listingTitle: b.listing.title,
    placeName: b.listing.place.name,
    source: b.source,
    status: b.status,
    checkIn: isoDay(b.checkIn),
    checkOut: isoDay(b.checkOut),
    nights: nightsBetween(b.checkIn, b.checkOut),
    externalRef: b.externalRef,
    guestName: b.guestName ?? b.guest?.name ?? null,
    guestPhone: b.guestPhone ?? b.guest?.phone ?? null,
    guestEmail: b.guestEmail ?? b.guest?.email ?? null,
    hasGuestAccount: b.guest !== null,
    adults: b.adults,
    children: b.children,
    infants: b.infants,
    pets: b.pets,
    channel: b.channel,
    note: b.note,
    createdAt: b.createdAt.toISOString(),
    cancelledAt: b.cancelledAt?.toISOString() ?? null,
  };
  if (showAmounts) {
    view.platformAmount =
      b.platformAmountCents !== null && b.platformCurrency && b.platformAmountKind ? { cents: b.platformAmountCents, currency: b.platformCurrency, kind: b.platformAmountKind } : null;
    view.amounts =
      b.totalCents === null || b.nightlyCents === null ? null : { nightlyCents: b.nightlyCents, cleaningFeeCents: b.cleaningFeeCents ?? 0, totalCents: b.totalCents };
  }
  return view;
}

// ---------- Reading ----------

export interface CalendarListing {
  id: string;
  title: string;
  placeName: string;
}

export interface CalendarFilters {
  /** Neighbourhood slug. */
  place?: string;
  /** Title or address, case-insensitive. */
  q?: string;
}

/**
 * The calendar of the organization's homes over [start, end): one row per home (drafts included: they can be on
 * the platforms before the site), and the confirmed bookings and owner blocks having a night in the window.
 * Cancelled bookings are left out.
 */
export async function calendarData(organizationId: string, start: Date, end: Date, filters: CalendarFilters, showAmounts: boolean) {
  const q = filters.q?.trim();
  const listingWhere: Prisma.ListingWhereInput = {
    organizationId,
    category: "HOME",
    ...(filters.place && { place: { slug: filters.place } }),
    ...(q && { OR: [{ title: { contains: q, mode: "insensitive" } }, { address: { contains: q, mode: "insensitive" } }] }),
  };
  const [listings, rows] = await Promise.all([
    db.listing.findMany({
      where: listingWhere,
      select: { id: true, title: true, place: { select: { name: true } } },
      orderBy: [{ place: { name: "asc" } }, { title: "asc" }, { id: "asc" }],
    }),
    db.booking.findMany({
      where: { organizationId, status: "CONFIRMED", checkIn: { lt: end }, checkOut: { gt: start }, listing: listingWhere },
      select: staffSelect,
      orderBy: [{ checkIn: "asc" }, { id: "asc" }],
    }),
  ]);
  return {
    listings: listings.map((l): CalendarListing => ({ id: l.id, title: l.title, placeName: l.place.name })),
    entries: rows.map((r) => toView(r, showAmounts)),
  };
}

export interface StaffBookingFilters {
  source?: BookingSource;
  listingId?: string;
  /** Bookings with a night on or after this day (checkOut > from). */
  from?: Date;
  /** Bookings with a night before this day (checkIn < to). */
  to?: Date;
  /** Default: confirmed only. "ALL" for both. */
  status?: BookingStatus | "ALL";
  page?: number;
}

/** The organization's bookings, filtered, by arrival date. */
export async function listStaffBookings(organizationId: string, filters: StaffBookingFilters, showAmounts: boolean) {
  const where: Prisma.BookingWhereInput = {
    organizationId,
    ...(filters.source && { source: filters.source }),
    ...(filters.listingId && { listingId: filters.listingId }),
    ...(filters.from && { checkOut: { gt: filters.from } }),
    ...(filters.to && { checkIn: { lt: filters.to } }),
    ...(filters.status !== "ALL" && { status: filters.status ?? "CONFIRMED" }),
  };
  const page = Math.max(1, filters.page ?? 1);
  const [total, rows] = await Promise.all([
    db.booking.count({ where }),
    db.booking.findMany({
      where,
      select: staffSelect,
      orderBy: [{ checkIn: "asc" }, { id: "asc" }],
      skip: (page - 1) * STAFF_BOOKINGS_PAGE_SIZE,
      take: STAFF_BOOKINGS_PAGE_SIZE,
    }),
  ]);
  return { items: rows.map((r) => toView(r, showAmounts)), total, page, pageCount: Math.max(1, Math.ceil(total / STAFF_BOOKINGS_PAGE_SIZE)) };
}

/** One booking of the organization, or null (unknown, or another organization's). */
export async function getStaffBooking(organizationId: string, id: string, showAmounts: boolean): Promise<StaffBookingView | null> {
  const row = await db.booking.findFirst({ where: { id, organizationId }, select: staffSelect });
  return row ? toView(row, showAmounts) : null;
}

export interface EntryListing {
  id: string;
  title: string;
  address: string;
  placeName: string;
  priceCents: number;
  cleaningFeeCents: number;
  minNights: number;
  maxGuests: number;
}

/**
 * The organization's price rules over the typing window (today … two years ahead), for the form's price preview of
 * a direct booking: the browser runs the same engine as the server (directAmounts).
 */
export async function entryPricingRules(organizationId: string, today = staffToday()): Promise<PricingRule[]> {
  return pricingRules(organizationId, { from: today, to: addDays(today, ENTRY_LIMITS.windowDays + ENTRY_LIMITS.maxNights) });
}

/** The homes a booking can be typed on, with what the form needs to price a direct booking. */
export async function entryListings(organizationId: string): Promise<EntryListing[]> {
  const rows = await db.listing.findMany({
    where: { organizationId, category: "HOME" },
    select: { id: true, title: true, address: true, priceCents: true, cleaningFeeCents: true, minNights: true, maxGuests: true, place: { select: { name: true } } },
    orderBy: [{ title: "asc" }, { id: "asc" }],
  });
  return rows.map(({ place, ...l }) => ({ ...l, placeName: place.name }));
}

// ---------- Writing ----------

/** Postgres exclusion-constraint violation (bookings_no_overlap): a concurrent write took the dates.
 * Also a deadlock (40P01) between inserts racing for the same nights: two pending inserts that each see the other in
 * the exclusion index wait for each other, and Postgres aborts one; the other goes on and takes the dates (or loses
 * them to a third), so the aborted one lost the race too.
 */
function isOverlapViolation(e: unknown): boolean {
  const text = e instanceof Error ? `${e.message} ${JSON.stringify((e as { meta?: unknown }).meta ?? "")}` : "";
  return text.includes("bookings_no_overlap") || text.includes("23P01") || text.includes("40P01");
}

function isDuplicateRef(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
}

/** "une réservation Airbnb (HMABC12345) du 12/05/2027 au 15/05/2027", "un blocage propriétaire du …". */
export function describeClash(b: { source: BookingSource; externalRef: string | null; checkIn: Date; checkOut: Date }): string {
  const dates = `du ${formatDate(b.checkIn)} au ${formatDate(b.checkOut)}`;
  if (b.source === "OWNER") return `un blocage propriétaire ${dates}`;
  if (b.source === "DIRECT") return `une réservation directe ${dates}`;
  return `une réservation ${SOURCE_LABEL[b.source]}${b.externalRef ? ` (${b.externalRef})` : ""} ${dates}`;
}

const OVERLAP_RACE = "Ces dates viennent d'être prises par une autre réservation ou un blocage : rechargez le calendrier.";

/** Refuses dates that overlap a confirmed booking or owner block of the listing (other than `excludeId`). */
async function assertFree(tx: Prisma.TransactionClient, organizationId: string, listingId: string, checkIn: Date, checkOut: Date, excludeId?: string) {
  const clash = await tx.booking.findFirst({
    where: {
      organizationId,
      listingId,
      status: "CONFIRMED",
      checkIn: { lt: checkOut },
      checkOut: { gt: checkIn },
      ...(excludeId && { id: { not: excludeId } }),
    },
    select: { source: true, externalRef: true, checkIn: true, checkOut: true },
    orderBy: { checkIn: "asc" },
  });
  if (clash) throw new AppError(409, "UNAVAILABLE", `Ces dates chevauchent ${describeClash(clash)}. Choisissez d'autres dates ou modifiez d'abord cette réservation.`);
}

/** Departure after today (a stay entirely in the past isn't typed by hand) and arrival within the window. */
function assertDates(checkIn: Date, checkOut: Date, today: Date) {
  if (checkOut <= today) throw new AppError(422, "INVALID_DATES", "Ce séjour est déjà terminé : le départ doit être après aujourd'hui.");
  if (checkIn > addDays(today, ENTRY_LIMITS.windowDays)) throw new AppError(422, "INVALID_DATES", "L'arrivée ne peut pas être plus de deux ans à l'avance.");
}

const SHORT_STAY_HINT = " Cochez « Accepter un séjour plus court » pour l'enregistrer quand même.";

async function lockListing(tx: Prisma.TransactionClient, organizationId: string, listingId: string) {
  const listing = await tx.listing.findFirst({
    where: { id: listingId, organizationId, category: "HOME" },
    select: { id: true, priceCents: true, cleaningFeeCents: true, minNights: true, maxGuests: true, place: { select: { timezone: true } } },
  });
  if (!listing) throw listingNotFound();
  return listing;
}

/** Runs a booking write; turns the database's last-line refusals into the team's messages. */
async function write<T>(fn: () => Promise<T>, platform?: { source: string; externalRef: string }): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isOverlapViolation(e)) throw new AppError(409, "UNAVAILABLE", OVERLAP_RACE);
    if (platform && isDuplicateRef(e)) throw duplicateRef(platform.source as BookingSource, platform.externalRef);
    throw e;
  }
}

const duplicateRef = (source: BookingSource, ref: string) =>
  new AppError(409, "DUPLICATE_REF", `La référence ${SOURCE_LABEL[source]} ${ref} est déjà enregistrée : ouvrez cette réservation plutôt que de la saisir à nouveau.`);

/**
 * Creates what an associé typed: a direct booking, a platform booking or an owner block, on a home of their
 * organization. "Today" is the listing's local date unless given (tests).
 */
export async function createStaffEntry(actor: Authorized, entry: BookingEntry, today?: Date): Promise<{ id: string }> {
  const { organizationId } = actor;
  return write(
    () =>
      db.$transaction(async (tx) => {
        const listing = await lockListing(tx, organizationId, entry.listingId);
        const localToday = today ?? todayInTimeZone(listing.place.timezone);
        assertDates(entry.checkIn, entry.checkOut, localToday);
        const nights = nightsBetween(entry.checkIn, entry.checkOut);
        const base = { organizationId, listingId: listing.id, checkIn: entry.checkIn, checkOut: entry.checkOut };
        const details: Prisma.InputJsonObject = { listingId: listing.id, checkIn: isoDay(entry.checkIn), checkOut: isoDay(entry.checkOut), nights };
        let data: Prisma.BookingUncheckedCreateInput;

        if (entry.kind === "blocage") {
          data = { ...base, source: "OWNER", adults: 0, note: entry.note };
          Object.assign(details, { source: "OWNER" });
        } else {
          if (entry.adults + entry.children > listing.maxGuests) {
            throw new AppError(422, "TOO_MANY_GUESTS", `Ce logement accueille ${listing.maxGuests} voyageurs au maximum (adultes et enfants).`);
          }
          const contact = {
            guestName: entry.guestName || null,
            guestPhone: entry.guestPhone || null,
            guestEmail: entry.guestEmail || null,
            adults: entry.adults,
            children: entry.children,
            infants: entry.infants,
            pets: entry.pets,
            note: entry.note || null,
          };
          if (entry.kind === "directe") {
            // Priced and checked like a booking on the site: seasons, events and their minimum stays.
            const rules = await pricingRules(organizationId, { from: entry.checkIn, to: entry.checkOut, listingId: listing.id }, tx);
            const a = directAmounts(listing, entry.checkIn, entry.checkOut, rules, { nightlyCents: entry.nightly, cleaningFeeCents: entry.cleaning });
            const shortStay = nights < a.minNights;
            if (shortStay && !entry.allowShortStay) throw new AppError(422, "MIN_NIGHTS", minNightsMessage(a.minNights) + SHORT_STAY_HINT);
            if (a.totalCents <= 0) throw new AppError(422, "INVALID_AMOUNT", "Le total d'une réservation directe doit être supérieur à 0 MAD.");
            data = {
              ...base,
              ...contact,
              source: "DIRECT",
              channel: entry.channel,
              nightlyCents: a.nightlyCents,
              cleaningFeeCents: a.cleaningFeeCents,
              serviceFeeCents: a.serviceFeeCents,
              totalCents: a.totalCents,
            };
            Object.assign(details, {
              source: "DIRECT",
              channel: entry.channel,
              totalCents: a.totalCents,
              priceOverridden: entry.nightly !== null || entry.cleaning !== null,
              ...(shortStay && { shortStayAccepted: true, minNights: a.minNights }),
            });
          } else {
            const existing = await tx.booking.findFirst({ where: { organizationId, source: entry.source, externalRef: entry.externalRef }, select: { id: true } });
            if (existing) throw duplicateRef(entry.source, entry.externalRef);
            const a = entry.total === null ? null : platformAmounts(entry.total, entry.cleaning ?? 0, nights);
            data = {
              ...base,
              ...contact,
              source: entry.source,
              externalRef: entry.externalRef,
              ...(a && { nightlyCents: a.nightlyCents, cleaningFeeCents: a.cleaningFeeCents, serviceFeeCents: a.serviceFeeCents, totalCents: a.totalCents }),
            };
            Object.assign(details, { source: entry.source, externalRef: entry.externalRef, ...(a && { totalCents: a.totalCents }) });
          }
        }

        await assertFree(tx, organizationId, listing.id, entry.checkIn, entry.checkOut);
        const created = await tx.booking.create({ data, select: { id: true } });
        // Linen, welcome and cleaning for a guest stay (none for an owner block): lib/operations/sync.ts.
        await syncBookingTasks(tx, created.id, { today: localToday });
        await recordAudit(tx, {
          organizationId,
          actorId: actor.user.id,
          action: entry.kind === "blocage" ? "owner_block.created" : "booking.created",
          targetType: "booking",
          targetId: created.id,
          details,
        });
        return created;
      }),
    entry.kind === "plateforme" ? { source: entry.source, externalRef: entry.externalRef } : undefined,
  );
}

/**
 * New dates for a confirmed booking or owner block, same listing. A direct booking is re-priced for the new number
 * of nights at its own nightly price and cleaning fee (rescheduledAmounts: the price agreed, not the seasons of the
 * new dates); the minimum stay of the new dates (seasons and events included) applies to it as at creation, with the
 * same override.
 */
export async function rescheduleStaffBooking(actor: Authorized, bookingId: string, input: Reschedule, today?: Date): Promise<void> {
  const { organizationId } = actor;
  await write(() =>
    db.$transaction(async (tx) => {
      const b = await tx.booking.findFirst({
        where: { id: bookingId, organizationId },
        select: {
          id: true,
          listingId: true,
          source: true,
          status: true,
          checkIn: true,
          checkOut: true,
          nightlyCents: true,
          cleaningFeeCents: true,
          serviceFeeCents: true,
          totalCents: true,
          listing: { select: { id: true, priceCents: true, cleaningFeeCents: true, minNights: true, place: { select: { timezone: true } } } },
        },
      });
      if (!b) throw bookingNotFound();
      if (b.status !== "CONFIRMED") throw new AppError(409, "CANCELLED", "Cette réservation est annulée : ses dates ne se modifient plus.");
      const localToday = today ?? todayInTimeZone(b.listing.place.timezone);
      assertDates(input.checkIn, input.checkOut, localToday);
      const nights = nightsBetween(input.checkIn, input.checkOut);
      // The minimum stay of the new dates, seasons and events included (direct bookings only).
      const minNights =
        b.source === "DIRECT"
          ? effectiveMinNights(b.listing, await pricingRules(organizationId, { from: input.checkIn, to: input.checkOut, listingId: b.listingId }, tx), input.checkIn, input.checkOut)
          : 0;
      const shortStay = b.source === "DIRECT" && nights < minNights;
      if (shortStay && !input.allowShortStay) throw new AppError(422, "MIN_NIGHTS", minNightsMessage(minNights) + SHORT_STAY_HINT);
      await assertFree(tx, organizationId, b.listingId, input.checkIn, input.checkOut, b.id);
      const amounts = rescheduledAmounts(b, nights);
      await tx.booking.update({
        where: { id: b.id, organizationId, status: "CONFIRMED" },
        data: { checkIn: input.checkIn, checkOut: input.checkOut, ...(amounts ?? {}) },
      });
      // Tasks not started yet follow the new dates.
      await syncBookingTasks(tx, b.id, { today: localToday, previous: { checkIn: b.checkIn, checkOut: b.checkOut } });
      // The taxe de séjour follows the new nights, unless closed (lib/server/declarations/tax.ts).
      await refreshExistingBookingTax(tx, organizationId, b.id, actor.user.id);
      await recordAudit(tx, {
        organizationId,
        actorId: actor.user.id,
        action: "booking.dates_changed",
        targetType: "booking",
        targetId: b.id,
        details: {
          source: b.source,
          from: { checkIn: isoDay(b.checkIn), checkOut: isoDay(b.checkOut) },
          to: { checkIn: isoDay(input.checkIn), checkOut: isoDay(input.checkOut) },
          ...(amounts && b.source === "DIRECT" && { totalCents: { from: b.totalCents, to: amounts.totalCents } }),
          ...(shortStay && { shortStayAccepted: true, minNights }),
        },
      });
    }),
  );
}

/**
 * Cancels a confirmed booking or lifts an owner block (the row is kept, status CANCELLED): its dates are free again.
 * Not once the stay is over. A platform booking cancelled here must also be cancelled on its platform.
 * Field tasks follow every write (create, new dates, cancellation) in the same transaction: lib/operations/sync.ts.
 */
export async function cancelStaffBooking(actor: Authorized, bookingId: string, today?: Date): Promise<{ source: BookingSource }> {
  const { organizationId } = actor;
  return db.$transaction(async (tx) => {
    const b = await tx.booking.findFirst({
      where: { id: bookingId, organizationId },
      select: { id: true, source: true, status: true, checkIn: true, checkOut: true, listing: { select: { place: { select: { timezone: true } } } } },
    });
    if (!b) throw bookingNotFound();
    if (b.status !== "CONFIRMED") throw new AppError(409, "NOT_CANCELLABLE", "Cette réservation est déjà annulée.");
    if (b.checkOut <= (today ?? todayInTimeZone(b.listing.place.timezone))) throw new AppError(409, "NOT_CANCELLABLE", "Ce séjour est terminé : il ne s'annule plus.");
    await tx.booking.update({ where: { id: b.id, organizationId, status: "CONFIRMED" }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    // Its tasks not started yet are cancelled; started and done ones are kept.
    await syncBookingTasks(tx, b.id, { today });
    await recordAudit(tx, {
      organizationId,
      actorId: actor.user.id,
      action: b.source === "OWNER" ? "owner_block.cancelled" : "booking.cancelled",
      targetType: "booking",
      targetId: b.id,
      details: { source: b.source, checkIn: isoDay(b.checkIn), checkOut: isoDay(b.checkOut) },
    });
    return { source: b.source };
  });
}

/** Today in Marrakech: the default start of the calendar and of the bookings list. */
export function staffToday(now = Date.now()): Date {
  return todayInTimeZone(MARRAKECH_TIMEZONE, now);
}

/** Neighbourhoods having homes of the organization, for the calendar's filter. */
export async function calendarPlaces(organizationId: string) {
  return db.place.findMany({
    where: { listings: { some: { organizationId, category: "HOME" } } },
    select: { slug: true, name: true },
    orderBy: { name: "asc" },
  });
}
