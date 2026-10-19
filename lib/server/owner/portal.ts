import "server-only";
import { addDays, isoDay } from "@/lib/admin/calendar";
import { licenseState, type LicenseStatus } from "@/lib/admin/license";
import { todayInTimeZone } from "@/lib/dates";
import { ownerEffect, totalsOf, type LedgerAccount, type MonthTotals } from "@/lib/finance/ledger";
import { addMonths, FINANCE_TIMEZONE, localMonth, monthRange, monthWindow } from "@/lib/finance/months";
import { expenseReference } from "@/lib/finance/statement";
import type { BookingSource, ManagementType } from "@/lib/generated/prisma/enums";
import { db } from "../db";

/**
 * The owner portal's data (/proprietaire, Lot 6b), read-only. Every query is filtered by the owner's id AND their
 * organization, server-side: an owner reads their own homes, the bookings of those homes, their own journal entries,
 * statements and documents, and the receipts of their homes' validated expenses — nothing else. Another owner's (or
 * another organization's) home is null, exactly like an unknown id (the pages answer « introuvable »).
 *
 * What an owner sees of a booking: dates, nights, source, number of guests; never the guest's name or contact, the
 * team's note, nor the booking's amounts (their revenue is on the statements and in « Revenus », from the journal).
 */

export interface OwnerViewer {
  userId: string;
  organizationId: string;
}

const listingWhere = (v: OwnerViewer) => ({ organizationId: v.organizationId, ownerId: v.userId });
const DAY = 86_400_000;
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const nightsBetween = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / DAY));

export interface OwnerListing {
  id: string;
  title: string;
  address: string;
  city: string;
  managementType: ManagementType;
  commissionBps: number;
  status: "DRAFT" | "PUBLISHED";
  license: { number: string | null; expiresAt: string | null; status: LicenseStatus };
  cover: string | null;
}

export async function ownerListings(v: OwnerViewer, now = new Date()): Promise<OwnerListing[]> {
  const today = todayInTimeZone(FINANCE_TIMEZONE, now.getTime());
  const rows = await db.listing.findMany({
    where: { ...listingWhere(v), category: "HOME" },
    select: { id: true, title: true, address: true, city: true, managementType: true, commissionBps: true, status: true, licenseNumber: true, licenseExpiresAt: true, photos: { select: { url: true }, orderBy: { position: "asc" }, take: 1 } },
    orderBy: [{ title: "asc" }, { id: "asc" }],
  });
  return rows.map((l) => ({
    id: l.id,
    title: l.title,
    address: l.address,
    city: l.city,
    managementType: l.managementType,
    commissionBps: l.commissionBps,
    status: l.status,
    license: { number: l.licenseNumber, expiresAt: l.licenseExpiresAt ? isoDay(l.licenseExpiresAt) : null, status: licenseState(l, today).status },
    cover: l.photos[0]?.url ?? null,
  }));
}

/** One of the owner's homes, or null (unknown, another owner's, another organization's). */
export async function ownerListing(v: OwnerViewer, id: string, now = new Date()): Promise<OwnerListing | null> {
  return (await ownerListings(v, now)).find((l) => l.id === id) ?? null;
}

export type OwnerBookingKind = "STAY" | "OWNER_BLOCK" | "PLATFORM_BLOCK";

export interface OwnerBooking {
  listingId: string;
  listingTitle: string;
  kind: OwnerBookingKind;
  source: BookingSource;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
}

const bookingSelect = { listingId: true, source: true, channelBlock: true, checkIn: true, checkOut: true, adults: true, children: true, listing: { select: { title: true } } } as const;

function bookingView(b: { listingId: string; source: BookingSource; channelBlock: boolean; checkIn: Date; checkOut: Date; adults: number; children: number; listing: { title: string } }): OwnerBooking {
  return {
    listingId: b.listingId,
    listingTitle: b.listing.title,
    kind: b.source === "OWNER" ? "OWNER_BLOCK" : b.channelBlock ? "PLATFORM_BLOCK" : "STAY",
    source: b.source,
    checkIn: isoDay(b.checkIn),
    checkOut: isoDay(b.checkOut),
    nights: nightsBetween(b.checkIn, b.checkOut),
    guests: b.source === "OWNER" || b.channelBlock ? 0 : b.adults + b.children,
  };
}

/** A home's confirmed bookings and blocks from `from` (default: 90 days ago) to `to` (default: in 400 days); null when the home isn't theirs. */
export async function ownerListingBookings(v: OwnerViewer, listingId: string, opts: { now?: Date; from?: string; to?: string } = {}): Promise<OwnerBooking[] | null> {
  const listing = await db.listing.findFirst({ where: { id: listingId, ...listingWhere(v) }, select: { id: true } });
  if (!listing) return null;
  const today = todayInTimeZone(FINANCE_TIMEZONE, (opts.now ?? new Date()).getTime());
  const from = opts.from ? utc(opts.from) : addDays(today, -90);
  const to = opts.to ? utc(opts.to) : addDays(today, 400);
  const rows = await db.booking.findMany({
    where: { organizationId: v.organizationId, listingId: listing.id, listing: { ownerId: v.userId }, status: "CONFIRMED", checkOut: { gt: from }, checkIn: { lt: to } },
    select: bookingSelect,
    orderBy: [{ checkIn: "asc" }, { id: "asc" }],
  });
  return rows.map(bookingView);
}

export interface OwnerDashboard {
  months: { month: string; listings: { listingId: string; title: string; bookedNights: number; ownerNights: number; nightsInMonth: number; occupancyPct: number }[]; bookedNights: number; availableNights: number; occupancyPct: number }[];
  /** Net due to the owner this year so far (journal: closed months and the current one, provisional). */
  yearToDateCents: number;
  year: string;
  /** All net due so far − all transfers recorded: what Sigma still owes (negative: owed to Sigma). */
  balanceCents: number;
  nextArrivals: OwnerBooking[];
  listings: number;
}

/** Nights of [checkIn, checkOut) inside [from, to). */
function overlap(checkIn: Date, checkOut: Date, from: Date, to: Date): number {
  const a = Math.max(checkIn.getTime(), from.getTime());
  const b = Math.min(checkOut.getTime(), to.getTime());
  return b > a ? Math.round((b - a) / DAY) : 0;
}

export async function ownerDashboard(v: OwnerViewer, now = new Date()): Promise<OwnerDashboard> {
  const today = todayInTimeZone(FINANCE_TIMEZONE, now.getTime());
  const current = localMonth(now);
  const months = [current, addMonths(current, 1)];
  const windowFrom = utc(monthWindow(months[0]).from);
  const windowTo = utc(monthWindow(months[1]).to);
  const year = current.slice(0, 4);
  const [listings, bookings, ytd, all, next] = await Promise.all([
    db.listing.findMany({ where: { ...listingWhere(v), category: "HOME" }, select: { id: true, title: true }, orderBy: [{ title: "asc" }, { id: "asc" }] }),
    db.booking.findMany({
      where: { organizationId: v.organizationId, listing: { ownerId: v.userId, organizationId: v.organizationId }, status: "CONFIRMED", channelBlock: false, checkOut: { gt: windowFrom }, checkIn: { lt: windowTo } },
      select: { listingId: true, source: true, checkIn: true, checkOut: true },
    }),
    db.financialEntry.groupBy({ by: ["account"], where: { organizationId: v.organizationId, ownerId: v.userId, period: { gte: `${year}-01`, lte: current } }, _sum: { amountCents: true } }),
    db.financialEntry.groupBy({ by: ["account"], where: { organizationId: v.organizationId, ownerId: v.userId }, _sum: { amountCents: true } }),
    db.booking.findMany({
      where: { organizationId: v.organizationId, listing: { ownerId: v.userId, organizationId: v.organizationId }, status: "CONFIRMED", channelBlock: false, source: { not: "OWNER" }, checkIn: { gte: today } },
      select: bookingSelect,
      orderBy: [{ checkIn: "asc" }, { id: "asc" }],
      take: 6,
    }),
  ]);
  const net = (rows: { account: string; _sum: { amountCents: number | null } }[]) => rows.reduce((s, r) => s + ownerEffect(r.account as LedgerAccount, r._sum.amountCents ?? 0), 0);
  const payouts = all.filter((r) => r.account === "OWNER_PAYOUT").reduce((s, r) => s + (r._sum.amountCents ?? 0), 0);
  return {
    months: months.map((month) => {
      const { from, to } = monthWindow(month);
      const f = utc(from);
      const t = utc(to);
      const nightsInMonth = nightsBetween(f, t);
      const rows = listings.map((l) => {
        const mine = bookings.filter((b) => b.listingId === l.id);
        const bookedNights = mine.filter((b) => b.source !== "OWNER").reduce((s, b) => s + overlap(b.checkIn, b.checkOut, f, t), 0);
        const ownerNights = mine.filter((b) => b.source === "OWNER").reduce((s, b) => s + overlap(b.checkIn, b.checkOut, f, t), 0);
        return { listingId: l.id, title: l.title, bookedNights, ownerNights, nightsInMonth, occupancyPct: nightsInMonth ? Math.round((bookedNights * 100) / nightsInMonth) : 0 };
      });
      const booked = rows.reduce((s, r) => s + r.bookedNights, 0);
      const available = rows.reduce((s, r) => s + r.nightsInMonth, 0);
      return { month, listings: rows, bookedNights: booked, availableNights: available, occupancyPct: available ? Math.round((booked * 100) / available) : 0 };
    }),
    yearToDateCents: net(ytd),
    year,
    balanceCents: net(all) - payouts,
    nextArrivals: next.map(bookingView),
    listings: listings.length,
  };
}

export interface OwnerMonthFigures {
  month: string;
  closed: boolean;
  totals: MonthTotals;
  /** Owner share of the stays + cleaning kept by the owner. */
  revenueCents: number;
  /** − rebilled expenses + advances reimbursed. */
  expensesNetCents: number;
  statementId: string | null;
}

/** The owner's figures of the last `count` months (most recent first), from the journal. */
export async function ownerMonthlyFigures(v: OwnerViewer, now = new Date(), count = 12): Promise<OwnerMonthFigures[]> {
  const current = localMonth(now);
  const first = addMonths(current, -(count - 1));
  const [rows, closings, statements] = await Promise.all([
    db.financialEntry.groupBy({ by: ["period", "account"], where: { organizationId: v.organizationId, ownerId: v.userId, period: { gte: first, lte: current } }, _sum: { amountCents: true } }),
    db.financeMonthClosing.findMany({ where: { organizationId: v.organizationId, closed: true, month: { gte: first, lte: current } }, select: { month: true } }),
    db.ownerStatement.findMany({ where: { organizationId: v.organizationId, ownerId: v.userId, month: { gte: first, lte: current } }, select: { id: true, month: true, version: true }, orderBy: { version: "desc" } }),
  ]);
  const closed = new Set(closings.map((c) => c.month));
  return monthRange(first, current)
    .reverse()
    .map((month) => {
      const totals = totalsOf(rows.filter((r) => r.period === month).map((r) => ({ account: r.account as LedgerAccount, amountCents: r._sum.amountCents ?? 0, originPeriod: null })));
      return {
        month,
        closed: closed.has(month),
        totals,
        revenueCents: totals.ownerShareCents + totals.cleaningOwnerCents,
        expensesNetCents: totals.ownerAdvancesCents - totals.expensesRebilledCents,
        statementId: statements.find((s) => s.month === month)?.id ?? null,
      };
    });
}

export interface OwnerReceipt {
  expenseId: string;
  reference: string;
  date: string;
  description: string;
  listingTitle: string;
  amountCents: number;
  contentType: string;
}

/** Receipts of the validated (or reversed) expenses of the owner's homes, newest first. */
export async function ownerReceipts(v: OwnerViewer, take = 100): Promise<OwnerReceipt[]> {
  const rows = await db.expense.findMany({
    where: { organizationId: v.organizationId, listing: { ownerId: v.userId, organizationId: v.organizationId }, status: { not: "DRAFT" }, receiptKey: { not: null } },
    select: { id: true, date: true, description: true, amountCents: true, receiptContentType: true, listing: { select: { title: true } } },
    orderBy: [{ date: "desc" }, { id: "asc" }],
    take,
  });
  return rows.map((e) => ({ expenseId: e.id, reference: expenseReference(e.id), date: isoDay(e.date), description: e.description, listingTitle: e.listing.title, amountCents: e.amountCents, contentType: e.receiptContentType ?? "" }));
}
