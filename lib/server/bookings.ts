import "server-only";
import { z } from "zod";
import { Prisma } from "@/lib/generated/prisma/client";
import { todayInTimeZone } from "@/lib/dates";
import { nightsBetween, priceBreakdown, type PriceBreakdown } from "@/lib/pricing";
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

/** "Ce logement se réserve pour 3 nuits minimum." (1 nuit, 2 nuits…). */
export function minNightsMessage(minNights: number): string {
  return `Ce logement se réserve pour ${minNights} nuit${minNights > 1 ? "s" : ""} minimum.`;
}

export interface Quote extends PriceBreakdown {
  listingId: string;
  checkIn: string;
  checkOut: string;
  nightlyCents: number;
  available: boolean;
}

/**
 * Validates a stay against the listing's rules and prices it. Throws AppError for anything that can't be
 * booked at all; `available` says whether the dates are free right now. "Today" is the listing's local
 * date unless `today` is given.
 */
export async function quoteStay(
  orgId: string,
  listingId: string,
  input: StayInput,
  today?: Date,
  tx: Prisma.TransactionClient = db,
): Promise<Quote> {
  const checkIn = fromISODate(input.checkIn);
  const checkOut = fromISODate(input.checkOut);
  const nights = nightsBetween(checkIn, checkOut);
  if (checkOut <= checkIn) throw new AppError(422, "INVALID_DATES", "Le départ doit être après l'arrivée.");
  if (nights > MAX_NIGHTS) throw new AppError(422, "INVALID_DATES", `Un séjour dure ${MAX_NIGHTS} nuits au maximum.`);

  const listing = await tx.listing.findFirst({
    where: { id: listingId, organizationId: orgId },
    select: {
      id: true,
      category: true,
      maxGuests: true,
      priceCents: true,
      cleaningFeeCents: true,
      minNights: true,
      place: { select: { timezone: true } },
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
    throw new AppError(422, "MIN_NIGHTS", minNightsMessage(listing.minNights));
  }
  if (input.adults + input.children > listing.maxGuests) {
    throw new AppError(422, "TOO_MANY_GUESTS", `Ce logement accueille ${listing.maxGuests} voyageurs au maximum.`);
  }
  if (input.pets > 0 && listing.amenities.length === 0) {
    throw new AppError(422, "PETS_NOT_ALLOWED", "Les animaux ne sont pas acceptés dans ce logement.");
  }

  const free = await tx.listing.count({ where: { id: listingId, organizationId: orgId, ...availableBetween(checkIn, checkOut) } });
  return {
    listingId,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    nightlyCents: listing.priceCents,
    available: free === 1,
    ...priceBreakdown(listing.priceCents, nights, listing.cleaningFeeCents),
  };
}

/** What a guest sees of their own booking: no guest contact fields (guestName/Email/Phone stay internal). */
const bookingSelect = {
  id: true,
  source: true,
  checkIn: true,
  checkOut: true,
  adults: true,
  children: true,
  infants: true,
  pets: true,
  nightlyCents: true,
  cleaningFeeCents: true,
  serviceFeeCents: true,
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

/** Books a stay on a listing of `orgId` for a guest account: a DIRECT booking of that organization. */
export async function createBooking(orgId: string, guestId: string, input: BookingInput, today?: Date): Promise<BookingView> {
  try {
    return await db.$transaction(async (tx) => {
      const owned = await tx.listing.findFirst({ where: { id: input.listingId, organizationId: orgId }, select: { ownerId: true } });
      // Owners block their own dates with an owner block (source OWNER, entered by the team), not as guests.
      if (owned?.ownerId === guestId) throw new AppError(403, "OWN_LISTING", "Vous ne pouvez pas réserver votre propre logement.");
      const q = await quoteStay(orgId, input.listingId, input, today, tx);
      if (!q.available) throw new AppError(409, "UNAVAILABLE", "Ces dates ne sont plus disponibles.");
      return tx.booking.create({
        data: {
          organizationId: orgId,
          listingId: input.listingId,
          source: "DIRECT",
          guestId,
          checkIn: fromISODate(input.checkIn),
          checkOut: fromISODate(input.checkOut),
          adults: input.adults,
          children: input.children,
          infants: input.infants,
          pets: input.pets,
          nightlyCents: q.nightlyCents,
          cleaningFeeCents: q.cleaningFeeCents,
          serviceFeeCents: q.serviceFeeCents,
          totalCents: q.totalCents,
        },
        select: bookingSelect,
      });
    });
  } catch (e) {
    if (isOverlapViolation(e)) throw new AppError(409, "UNAVAILABLE", "Ces dates ne sont plus disponibles.");
    throw e;
  }
}

/**
 * The guest's stays in this organization only: rows whose guestId is this account. Platform bookings and owner
 * blocks have no account (guestId NULL), so they never show up in anyone's trips.
 */
export async function listBookings(orgId: string, guestId: string): Promise<BookingView[]> {
  return db.booking.findMany({ where: { organizationId: orgId, guestId }, select: bookingSelect, orderBy: { checkIn: "desc" } });
}

/**
 * Guests can cancel their own confirmed direct stays until the day before arrival (listing's local date). A platform
 * booking is cancelled on its platform (the change then reaches Sigma by iCal or e-mail, lot 7).
 */
export async function cancelBooking(orgId: string, guestId: string, bookingId: string, today?: Date): Promise<BookingView> {
  const booking = await db.booking.findFirst({
    where: { id: bookingId, organizationId: orgId },
    select: { guestId: true, source: true, status: true, checkIn: true, listing: { select: { place: { select: { timezone: true } } } } },
  });
  // Someone else's booking, or another organization's, reads as missing, so ids can't be probed.
  if (!booking || booking.guestId !== guestId) throw new AppError(404, "NOT_FOUND", "Réservation introuvable.");
  if (booking.status !== "CONFIRMED") throw new AppError(409, "NOT_CANCELLABLE", "Cette réservation est déjà annulée.");
  if (booking.source !== "DIRECT") {
    throw new AppError(409, "NOT_CANCELLABLE", "Cette réservation a été faite sur une plateforme : annulez-la sur cette plateforme.");
  }
  if (booking.checkIn <= (today ?? todayInTimeZone(booking.listing.place.timezone))) {
    throw new AppError(409, "NOT_CANCELLABLE", "Le séjour a déjà commencé.");
  }
  return db.booking.update({
    where: { id: bookingId, organizationId: orgId, source: "DIRECT", status: "CONFIRMED" },
    data: { status: "CANCELLED", cancelledAt: new Date() },
    select: bookingSelect,
  });
}
