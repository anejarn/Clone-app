import "server-only";
import { z } from "zod";
import { Prisma } from "@/lib/generated/prisma/client";
import { todayInTimeZone } from "@/lib/dates";
import { nightsBetween, priceStay, type GuestPrice, type HostSplit } from "@/lib/pricing";
import { fromISODate, isoDate } from "@/lib/search/params";
import { availableBetween } from "./catalog";
import { db } from "./db";
import { AppError } from "./errors";
import { idSchema } from "./schemas";

export const MAX_NIGHTS = 60;
/** How far ahead stays can start. */
export const BOOKING_WINDOW_DAYS = 365;
const DAY = 86_400_000;

export const stayInputSchema = z.object({
  checkIn: isoDate,
  checkOut: isoDate,
  adults: z.coerce.number().int().min(1).max(16),
  children: z.coerce.number().int().min(0).max(15).default(0),
  infants: z.coerce.number().int().min(0).max(5).default(0),
  pets: z.coerce.number().int().min(0).max(5).default(0),
});
export const bookingInputSchema = stayInputSchema.extend({ listingId: idSchema });

export type StayInput = z.infer<typeof stayInputSchema>;
export type BookingInput = z.infer<typeof bookingInputSchema>;

export function utcToday(now = Date.now()): Date {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export interface Quote extends GuestPrice {
  listingId: string;
  checkIn: string;
  checkOut: string;
  available: boolean;
  minNights: number;
  /** Commission and payout: stored on the booking, never sent to guests (see publicQuote). */
  host: HostSplit;
}

/** The guest-facing lines of a quote: what GET /api/listings/:id/quote returns. */
export function publicQuote(q: Quote) {
  return {
    available: q.available,
    nights: q.nights,
    nightlyCents: q.nightlyCents,
    stayCents: q.stayCents,
    cleaningFeeCents: q.cleaningFeeCents,
    touristTaxCents: q.touristTaxCents,
    totalCents: q.totalCents,
    minNights: q.minNights,
  };
}

/**
 * Validates a stay against the listing's rules and prices it. Throws AppError for anything that can't be
 * booked at all; `available` says whether the dates are free right now. "Today" is the listing's local
 * date unless `today` is given.
 */
export async function quoteStay(listingId: string, input: StayInput, today?: Date, tx: Prisma.TransactionClient = db): Promise<Quote> {
  const checkIn = fromISODate(input.checkIn);
  const checkOut = fromISODate(input.checkOut);
  const nights = nightsBetween(checkIn, checkOut);
  if (checkOut <= checkIn) throw new AppError(422, "INVALID_DATES", "Le départ doit être après l'arrivée.");
  if (nights > MAX_NIGHTS) throw new AppError(422, "INVALID_DATES", `Un séjour dure ${MAX_NIGHTS} nuits au maximum.`);

  const listing = await tx.listing.findUnique({
    where: { id: listingId },
    select: {
      id: true,
      category: true,
      maxGuests: true,
      priceCents: true,
      cleaningFeeCents: true,
      stars: true,
      minNights: true,
      place: { select: { timezone: true, inseeCode: true } },
      host: { select: { isFoundingHost: true } },
      amenities: { where: { amenityId: "animaux" }, select: { amenityId: true } },
    },
  });
  if (!listing) throw new AppError(404, "NOT_FOUND", "Logement introuvable.");
  const localToday = today ?? todayInTimeZone(listing.place.timezone);
  if (checkIn < localToday) throw new AppError(422, "INVALID_DATES", "L'arrivée ne peut pas être dans le passé.");
  if (checkIn.getTime() > localToday.getTime() + BOOKING_WINDOW_DAYS * DAY) {
    throw new AppError(422, "INVALID_DATES", "Les réservations ouvrent un an à l'avance.");
  }
  if (listing.category !== "HOME") throw new AppError(422, "NOT_BOOKABLE", "Seuls les logements se réservent à la nuit.");
  if (nights < listing.minNights) {
    throw new AppError(422, "MIN_NIGHTS", `Ce logement se réserve pour ${listing.minNights} nuit${listing.minNights > 1 ? "s" : ""} minimum.`);
  }
  if (input.adults + input.children > listing.maxGuests) {
    throw new AppError(422, "TOO_MANY_GUESTS", `Ce logement accueille ${listing.maxGuests} voyageurs au maximum.`);
  }
  if (input.pets > 0 && listing.amenities.length === 0) {
    throw new AppError(422, "PETS_NOT_ALLOWED", "Les animaux ne sont pas acceptés dans ce logement.");
  }

  const { guest, host } = priceStay({
    nightlyCents: listing.priceCents,
    cleaningFeeCents: listing.cleaningFeeCents,
    nights,
    checkIn: input.checkIn,
    inseeCode: listing.place.inseeCode,
    stars: listing.stars,
    isFoundingHost: listing.host.isFoundingHost,
    adults: input.adults,
    children: input.children,
    infants: input.infants,
  });
  const free = await tx.listing.count({ where: { id: listingId, ...availableBetween(checkIn, checkOut) } });
  return {
    listingId,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    available: free === 1,
    minNights: listing.minNights,
    ...guest,
    host,
  };
}

/**
 * What a guest sees of their booking: the guest-side price lines only. Commission, its VAT and the host
 * payout stay in the table (written by createBooking) and are left out here on purpose.
 */
const bookingSelect = {
  id: true,
  checkIn: true,
  checkOut: true,
  adults: true,
  children: true,
  infants: true,
  pets: true,
  nightlyCents: true,
  cleaningFeeCents: true,
  touristTaxCents: true,
  totalCents: true,
  status: true,
  createdAt: true,
  listing: {
    select: {
      id: true,
      title: true,
      propertyType: true,
      place: { select: { name: true, slug: true } },
      photos: { select: { url: true }, orderBy: { position: "asc" }, take: 1 },
    },
  },
} satisfies Prisma.BookingSelect;

export type BookingView = Prisma.BookingGetPayload<{ select: typeof bookingSelect }>;

/** Postgres exclusion-constraint violation: another confirmed stay overlaps (lost a race with the pre-check). */
function isOverlapViolation(e: unknown): boolean {
  const text = e instanceof Error ? `${e.message} ${JSON.stringify((e as { meta?: unknown }).meta ?? "")}` : "";
  return text.includes("bookings_no_overlap") || text.includes("23P01");
}

export async function createBooking(guestId: string, input: BookingInput, today?: Date): Promise<BookingView> {
  try {
    return await db.$transaction(async (tx) => {
      const host = await tx.listing.findUnique({ where: { id: input.listingId }, select: { hostId: true } });
      if (host?.hostId === guestId) throw new AppError(403, "OWN_LISTING", "Vous ne pouvez pas réserver votre propre logement.");
      const q = await quoteStay(input.listingId, input, today, tx);
      if (!q.available) throw new AppError(409, "UNAVAILABLE", "Ces dates ne sont plus disponibles.");
      return tx.booking.create({
        data: {
          listingId: input.listingId,
          guestId,
          checkIn: fromISODate(input.checkIn),
          checkOut: fromISODate(input.checkOut),
          adults: input.adults,
          children: input.children,
          infants: input.infants,
          pets: input.pets,
          nightlyCents: q.nightlyCents,
          cleaningFeeCents: q.cleaningFeeCents,
          touristTaxCents: q.touristTaxCents,
          totalCents: q.totalCents,
          commissionBps: q.host.commissionBps,
          commissionCents: q.host.commissionCents,
          commissionVatCents: q.host.commissionVatCents,
          hostPayoutCents: q.host.hostPayoutCents,
        },
        select: bookingSelect,
      });
    });
  } catch (e) {
    if (isOverlapViolation(e)) throw new AppError(409, "UNAVAILABLE", "Ces dates ne sont plus disponibles.");
    throw e;
  }
}

export async function listBookings(guestId: string): Promise<BookingView[]> {
  return db.booking.findMany({ where: { guestId }, select: bookingSelect, orderBy: { checkIn: "desc" } });
}

/** Guests can cancel their own confirmed stays until the day before arrival (listing's local date). */
export async function cancelBooking(guestId: string, bookingId: string, today?: Date): Promise<BookingView> {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: { guestId: true, status: true, checkIn: true, listing: { select: { place: { select: { timezone: true } } } } },
  });
  // Someone else's booking reads as missing, so ids can't be probed.
  if (!booking || booking.guestId !== guestId) throw new AppError(404, "NOT_FOUND", "Réservation introuvable.");
  if (booking.status !== "CONFIRMED") throw new AppError(409, "NOT_CANCELLABLE", "Cette réservation est déjà annulée.");
  if (booking.checkIn <= (today ?? todayInTimeZone(booking.listing.place.timezone))) {
    throw new AppError(409, "NOT_CANCELLABLE", "Le séjour a déjà commencé.");
  }
  return db.booking.update({
    where: { id: bookingId, status: "CONFIRMED" },
    data: { status: "CANCELLED", cancelledAt: new Date() },
    select: bookingSelect,
  });
}
