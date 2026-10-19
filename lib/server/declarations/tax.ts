import "server-only";
import { syncBookingFinance } from "@/lib/finance/post";
import { isoDay } from "@/lib/admin/calendar";
import { todayInTimeZone } from "@/lib/dates";
import { RETENTION_WARNING, IDENTITY_RETENTION_LIMITS } from "@/lib/declarations/retention";
import type { TravelerIdentity } from "@/lib/declarations/traveler-form";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { TouristTaxBasis } from "@/lib/generated/prisma/enums";
import { MARRAKECH_TIMEZONE } from "@/lib/neighbourhoods";
import { decryptIdentity } from "@/lib/secrets/identity";
import { computeStayTax, monthBounds, monthTotals, taxGuests, type ListingTaxVersion, type OrgTaxVersion, type StayTax, type TaxNight } from "@/lib/tax/engine";
import { recordAudit } from "../audit";
import type { Authorized } from "../authz";
import { db } from "../db";
import { AppError } from "../errors";

/**
 * Taxe de séjour in the back-office (Lot 5): the organization's rate versions and the homes' overrides (Paramètres,
 * ADMIN), the snapshot of each stay (computed by lib/tax/engine.ts, stored in booking_tourist_taxes) and the monthly
 * report by home (Déclarations → Taxe de séjour). Every function reads or writes the caller's organization only.
 *
 * Snapshot: refreshed when travellers are recorded or changed (lib/server/declarations/travelers.ts), when the dates
 * change (lib/server/admin/bookings.ts) and on request (« Calculer »), from the recorded travellers completed by the
 * booking's counts (taxGuests) — or the counts alone before any fiche. Once an associé closes it (« Clôturer »), it no
 * longer changes, whatever the rates or the fiches; reopening it is audited.
 *
 * Rates: a new version takes effect on its date and never changes the nights before; a version may be deleted only
 * before it is in force. The first version of the organization (or of a home) may start in the past, to cover the
 * stays already there; later ones start today or later. Real rates and exemptions: to be confirmed by Sigma.
 */

const bookingNotFound = () => new AppError(404, "NOT_FOUND", "Réservation introuvable.");

export const TAX_LIMITS = { maxRateCents: 100_000, minorsAge: { min: 1, max: 25 }, note: 200 };

function today(): string {
  return isoDay(todayInTimeZone(MARRAKECH_TIMEZONE));
}

// ---------- Rate versions ----------

export async function taxVersions(tx: Prisma.TransactionClient, organizationId: string, listingIds?: string[]): Promise<{ org: OrgTaxVersion[]; listing: ListingTaxVersion[] }> {
  const [org, listing] = await Promise.all([
    tx.touristTaxRate.findMany({ where: { organizationId }, orderBy: { effectiveFrom: "asc" } }),
    tx.listingTouristTaxRate.findMany({ where: { organizationId, ...(listingIds && { listingId: { in: listingIds } }) }, orderBy: { effectiveFrom: "asc" } }),
  ]);
  return {
    org: org.map((v) => ({ id: v.id, effectiveFrom: isoDay(v.effectiveFrom), rateCents: v.rateCents, minorsExemptUnder: v.minorsExemptUnder, residentsExempt: v.residentsExempt })),
    listing: listing.map((v) => ({ id: v.id, listingId: v.listingId, effectiveFrom: isoDay(v.effectiveFrom), rateCents: v.rateCents })),
  };
}

export interface TaxSettingsView {
  retentionDays: number;
  retentionWarning: string;
  orgRates: { id: string; effectiveFrom: string; rateCents: number; minorsExemptUnder: number | null; residentsExempt: boolean; note: string; inForce: boolean; deletable: boolean }[];
  listingRates: { id: string; listingId: string; listingTitle: string; effectiveFrom: string; rateCents: number | null; note: string; deletable: boolean }[];
  listings: { id: string; title: string }[];
  today: string;
}

/** Everything the settings page shows. */
export async function taxSettings(organizationId: string): Promise<TaxSettingsView> {
  const t = today();
  const [org, rates, listingRates, listings] = await Promise.all([
    db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { identityRetentionDays: true } }),
    db.touristTaxRate.findMany({ where: { organizationId }, orderBy: { effectiveFrom: "desc" } }),
    db.listingTouristTaxRate.findMany({ where: { organizationId }, orderBy: [{ listing: { title: "asc" } }, { effectiveFrom: "desc" }], include: { listing: { select: { title: true } } } }),
    db.listing.findMany({ where: { organizationId, category: "HOME" }, select: { id: true, title: true }, orderBy: [{ title: "asc" }, { id: "asc" }] }),
  ]);
  const current = rates.find((r) => isoDay(r.effectiveFrom) <= t)?.id;
  return {
    retentionDays: org.identityRetentionDays,
    retentionWarning: RETENTION_WARNING,
    orgRates: rates.map((r) => ({
      id: r.id,
      effectiveFrom: isoDay(r.effectiveFrom),
      rateCents: r.rateCents,
      minorsExemptUnder: r.minorsExemptUnder,
      residentsExempt: r.residentsExempt,
      note: r.note,
      inForce: r.id === current,
      deletable: isoDay(r.effectiveFrom) > t,
    })),
    listingRates: listingRates.map((r) => ({
      id: r.id,
      listingId: r.listingId,
      listingTitle: r.listing.title,
      effectiveFrom: isoDay(r.effectiveFrom),
      rateCents: r.rateCents,
      note: r.note,
      deletable: isoDay(r.effectiveFrom) > t,
    })),
    listings,
    today: t,
  };
}

export interface OrgRateInput {
  effectiveFrom: string;
  rateCents: number;
  minorsExemptUnder: number | null;
  residentsExempt: boolean;
  note: string;
}

export interface ListingRateInput {
  listingId: string;
  effectiveFrom: string;
  /** null = the organization's rate again. */
  rateCents: number | null;
  note: string;
}

function assertStart(effectiveFrom: string, isFirst: boolean) {
  if (!isFirst && effectiveFrom < today()) {
    throw new AppError(422, "PAST_RATE", "Un nouveau taux prend effet aujourd'hui ou plus tard : les nuits passées gardent le taux qui était en vigueur.");
  }
}

const isDuplicate = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
const duplicate = () => new AppError(409, "DUPLICATE_RATE", "Un taux prend déjà effet à cette date : supprimez-le d'abord s'il n'est pas encore en vigueur.");

export async function addOrgTaxRate(actor: Authorized, input: OrgRateInput): Promise<{ id: string }> {
  const { organizationId } = actor;
  try {
    return await db.$transaction(async (tx) => {
      assertStart(input.effectiveFrom, (await tx.touristTaxRate.count({ where: { organizationId } })) === 0);
      const r = await tx.touristTaxRate.create({
        data: { organizationId, effectiveFrom: new Date(`${input.effectiveFrom}T00:00:00Z`), rateCents: input.rateCents, minorsExemptUnder: input.minorsExemptUnder, residentsExempt: input.residentsExempt, note: input.note, createdById: actor.user.id },
        select: { id: true },
      });
      await recordAudit(tx, { organizationId, actorId: actor.user.id, action: "tourist_tax.rate_added", targetType: "organization", targetId: organizationId, details: { rateId: r.id, ...input } });
      return r;
    });
  } catch (e) {
    if (isDuplicate(e)) throw duplicate();
    throw e;
  }
}

export async function addListingTaxRate(actor: Authorized, input: ListingRateInput): Promise<{ id: string }> {
  const { organizationId } = actor;
  try {
    return await db.$transaction(async (tx) => {
      const listing = await tx.listing.findFirst({ where: { id: input.listingId, organizationId, category: "HOME" }, select: { id: true } });
      if (!listing) throw new AppError(404, "NOT_FOUND", "Bien introuvable.");
      assertStart(input.effectiveFrom, (await tx.listingTouristTaxRate.count({ where: { listingId: listing.id } })) === 0);
      const r = await tx.listingTouristTaxRate.create({
        data: { organizationId, listingId: listing.id, effectiveFrom: new Date(`${input.effectiveFrom}T00:00:00Z`), rateCents: input.rateCents, note: input.note, createdById: actor.user.id },
        select: { id: true },
      });
      await recordAudit(tx, { organizationId, actorId: actor.user.id, action: "tourist_tax.rate_added", targetType: "listing", targetId: listing.id, details: { rateId: r.id, ...input } });
      return r;
    });
  } catch (e) {
    if (isDuplicate(e)) throw duplicate();
    throw e;
  }
}

/** Only a version not yet in force (effective after today). */
export async function deleteTaxRate(actor: Authorized, kind: "org" | "listing", id: string): Promise<void> {
  const { organizationId } = actor;
  const notFound = () => new AppError(404, "NOT_FOUND", "Taux introuvable.");
  await db.$transaction(async (tx) => {
    const row =
      kind === "org"
        ? await tx.touristTaxRate.findFirst({ where: { id, organizationId }, select: { id: true, effectiveFrom: true } })
        : await tx.listingTouristTaxRate.findFirst({ where: { id, organizationId }, select: { id: true, effectiveFrom: true, listingId: true } });
    if (!row) throw notFound();
    if (isoDay(row.effectiveFrom) <= today()) throw new AppError(409, "RATE_IN_FORCE", "Ce taux est déjà en vigueur : il ne se supprime plus (ajoutez un nouveau taux à partir d'une date).");
    if (kind === "org") await tx.touristTaxRate.delete({ where: { id: row.id } });
    else await tx.listingTouristTaxRate.delete({ where: { id: row.id } });
    await recordAudit(tx, {
      organizationId,
      actorId: actor.user.id,
      action: "tourist_tax.rate_deleted",
      targetType: kind === "org" ? "organization" : "listing",
      targetId: "listingId" in row ? String(row.listingId) : organizationId,
      details: { rateId: row.id, effectiveFrom: isoDay(row.effectiveFrom) },
    });
  });
}

export async function updateIdentityRetention(actor: Authorized, days: number): Promise<void> {
  if (!Number.isInteger(days) || days < IDENTITY_RETENTION_LIMITS.min || days > IDENTITY_RETENTION_LIMITS.max) {
    throw new AppError(422, "INVALID_RETENTION", `Entre ${IDENTITY_RETENTION_LIMITS.min} et ${IDENTITY_RETENTION_LIMITS.max} jours.`);
  }
  await db.$transaction(async (tx) => {
    const before = await tx.organization.findUniqueOrThrow({ where: { id: actor.organizationId }, select: { identityRetentionDays: true } });
    await tx.organization.update({ where: { id: actor.organizationId }, data: { identityRetentionDays: days } });
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.user.id,
      action: "organization.identity_retention_updated",
      targetType: "organization",
      targetId: actor.organizationId,
      details: { from: before.identityRetentionDays, to: days },
    });
  });
}

// ---------- A stay's snapshot ----------

interface BookingForTax {
  id: string;
  organizationId: string;
  listingId: string;
  source: string;
  checkIn: Date;
  checkOut: Date;
  adults: number;
  children: number;
  infants: number;
}

/** The tax of a booking as it would be computed now, and from what. */
export async function computeBookingTax(tx: Prisma.TransactionClient, b: BookingForTax): Promise<{ tax: StayTax; basis: TouristTaxBasis }> {
  const versions = await taxVersions(tx, b.organizationId, [b.listingId]);
  const rows = await tx.traveler.findMany({ where: { bookingId: b.id, organizationId: b.organizationId }, select: { id: true, identityEnc: true, isMinor: true } });
  const travelers = rows.map((r) => {
    const i = decryptIdentity<TravelerIdentity>(r.identityEnc, { organizationId: b.organizationId, bookingId: b.id, travelerId: r.id });
    return { birthDate: i.birthDate ?? null, isMinor: r.isMinor, residenceCountry: i.residenceCountry ?? null };
  });
  const checkIn = isoDay(b.checkIn);
  const guests = taxGuests({ checkIn, adults: b.adults, children: b.children, infants: b.infants }, travelers);
  const tax = computeStayTax({ listingId: b.listingId, checkIn, checkOut: isoDay(b.checkOut), guests, orgVersions: versions.org, listingVersions: versions.listing });
  return { tax, basis: travelers.length ? "TRAVELERS" : "BOOKING" };
}

const bookingTaxSelect = { id: true, organizationId: true, listingId: true, source: true, checkIn: true, checkOut: true, adults: true, children: true, infants: true } as const;

/**
 * Recomputes and stores a booking's snapshot, unless it is closed or the booking is an owner block. Runs inside the
 * caller's transaction (travellers' changes, new dates). Returns whether it was written.
 */
export async function refreshBookingTax(tx: Prisma.TransactionClient, organizationId: string, bookingId: string, actorId: string | null): Promise<boolean> {
  const b = await tx.booking.findFirst({ where: { id: bookingId, organizationId }, select: { ...bookingTaxSelect, touristTax: { select: { closedAt: true } } } });
  if (!b || b.source === "OWNER" || b.touristTax?.closedAt) return false;
  const { tax, basis } = await computeBookingTax(tx, b);
  const data = {
    totalCents: tax.totalCents,
    nights: tax.nights,
    taxableGuestNights: tax.taxableGuestNights,
    exemptGuestNights: tax.exemptGuestNights,
    missingRateNights: tax.missingRateNights,
    basis,
    lines: tax.lines as unknown as Prisma.InputJsonArray,
    computedAt: new Date(),
    computedById: actorId,
  };
  await tx.bookingTouristTax.upsert({ where: { bookingId: b.id }, create: { bookingId: b.id, organizationId, ...data }, update: data });
  // The tax is carried next to the stay's split and posted to its own account (Lot 6).
  await syncBookingFinance(tx, b.id, { actorId });
  return true;
}

/** Refreshes a snapshot only if the booking already has one (open). For the booking writes of the back-office. */
export async function refreshExistingBookingTax(tx: Prisma.TransactionClient, organizationId: string, bookingId: string, actorId: string | null): Promise<void> {
  const snap = await tx.bookingTouristTax.findFirst({ where: { bookingId, organizationId }, select: { closedAt: true } });
  if (snap && !snap.closedAt) await refreshBookingTax(tx, organizationId, bookingId, actorId);
}

export interface BookingTaxView {
  totalCents: number;
  nights: number;
  taxableGuestNights: number;
  exemptGuestNights: number;
  missingRateNights: number;
  basis: TouristTaxBasis;
  computedAt: string;
  closedAt: string | null;
  lines: TaxNight[];
}

/** The stored snapshot of a booking (ADMIN), or null when none was computed yet. */
export async function getBookingTax(organizationId: string, bookingId: string): Promise<BookingTaxView | null> {
  const s = await db.bookingTouristTax.findFirst({ where: { bookingId, organizationId } });
  if (!s) return null;
  return {
    totalCents: s.totalCents,
    nights: s.nights,
    taxableGuestNights: s.taxableGuestNights,
    exemptGuestNights: s.exemptGuestNights,
    missingRateNights: s.missingRateNights,
    basis: s.basis,
    computedAt: s.computedAt.toISOString(),
    closedAt: s.closedAt?.toISOString() ?? null,
    lines: s.lines as unknown as TaxNight[],
  };
}

/** « Calculer » / « Recalculer » on the booking's page. */
export async function computeTaxNow(actor: Authorized, bookingId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const b = await tx.booking.findFirst({ where: { id: bookingId, organizationId: actor.organizationId }, select: { source: true, touristTax: { select: { closedAt: true } } } });
    if (!b) throw bookingNotFound();
    if (b.source === "OWNER") throw new AppError(422, "OWNER_BLOCK", "Un blocage propriétaire n'a pas de taxe de séjour.");
    if (b.touristTax?.closedAt) throw new AppError(409, "TAX_CLOSED", "La taxe de séjour de ce séjour est clôturée : rouvrez-la pour la recalculer.");
    await refreshBookingTax(tx, actor.organizationId, bookingId, actor.user.id);
  });
}

/** Closes (freezes) or reopens a snapshot. Closing computes it first when there is none. */
export async function setTaxClosed(actor: Authorized, bookingId: string, closed: boolean): Promise<void> {
  const { organizationId } = actor;
  await db.$transaction(async (tx) => {
    const b = await tx.booking.findFirst({ where: { id: bookingId, organizationId }, select: { id: true, source: true, touristTax: { select: { closedAt: true } } } });
    if (!b) throw bookingNotFound();
    if (b.source === "OWNER") throw new AppError(422, "OWNER_BLOCK", "Un blocage propriétaire n'a pas de taxe de séjour.");
    if (closed) {
      if (b.touristTax?.closedAt) return;
      await refreshBookingTax(tx, organizationId, b.id, actor.user.id);
      await tx.bookingTouristTax.update({ where: { bookingId: b.id }, data: { closedAt: new Date(), closedById: actor.user.id } });
    } else {
      if (!b.touristTax?.closedAt) return;
      await tx.bookingTouristTax.update({ where: { bookingId: b.id }, data: { closedAt: null, closedById: null } });
    }
    const snap = await tx.bookingTouristTax.findUniqueOrThrow({ where: { bookingId: b.id }, select: { totalCents: true } });
    await recordAudit(tx, {
      organizationId,
      actorId: actor.user.id,
      action: closed ? "tourist_tax.closed" : "tourist_tax.reopened",
      targetType: "booking",
      targetId: b.id,
      details: { totalCents: snap.totalCents },
    });
  });
}

// ---------- Monthly report ----------

export interface TaxReportRow {
  listingId: string;
  listingTitle: string;
  licenseNumber: string | null;
  stays: number;
  nights: number;
  taxableGuestNights: number;
  totalCents: number;
  /** Stays counted from the booking's figures because no snapshot was computed yet (« estimé »). */
  estimated: number;
  /** Nights without any rate in force. */
  missingRateNights: number;
  /** Stays whose snapshot is closed. */
  closed: number;
}

/**
 * The taxe de séjour of a month (yyyy-MM) by home: the nights of that month of every confirmed guest stay (a stay
 * across two months counts in each for its own nights). From the stored snapshots; a stay without one is computed
 * on the fly from its booking's figures and flagged « estimé ».
 */
export async function monthlyTaxReport(organizationId: string, month: string): Promise<{ month: string; rows: TaxReportRow[]; totalCents: number }> {
  const { from, to } = monthBounds(month);
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const bookings = await db.booking.findMany({
    where: { organizationId, status: "CONFIRMED", source: { not: "OWNER" }, checkIn: { lt: end }, checkOut: { gt: start } },
    select: { ...bookingTaxSelect, touristTax: { select: { lines: true, closedAt: true } }, listing: { select: { title: true, licenseNumber: true } } },
    orderBy: [{ checkIn: "asc" }, { id: "asc" }],
  });
  const versions = await taxVersions(db, organizationId);
  const byListing = new Map<string, TaxReportRow>();
  for (const b of bookings) {
    let lines: TaxNight[];
    let estimated = false;
    if (b.touristTax) lines = b.touristTax.lines as unknown as TaxNight[];
    else {
      estimated = true;
      const checkIn = isoDay(b.checkIn);
      lines = computeStayTax({
        listingId: b.listingId,
        checkIn,
        checkOut: isoDay(b.checkOut),
        guests: taxGuests({ checkIn, adults: b.adults, children: b.children, infants: b.infants }, []),
        orgVersions: versions.org,
        listingVersions: versions.listing,
      }).lines;
    }
    const m = monthTotals(lines, month);
    const row = byListing.get(b.listingId) ?? {
      listingId: b.listingId,
      listingTitle: b.listing.title,
      licenseNumber: b.listing.licenseNumber,
      stays: 0,
      nights: 0,
      taxableGuestNights: 0,
      totalCents: 0,
      estimated: 0,
      missingRateNights: 0,
      closed: 0,
    };
    row.stays += 1;
    row.nights += m.nights;
    row.taxableGuestNights += m.taxableGuestNights;
    row.totalCents += m.totalCents;
    row.missingRateNights += m.missingRateNights;
    if (estimated) row.estimated += 1;
    if (b.touristTax?.closedAt) row.closed += 1;
    byListing.set(b.listingId, row);
  }
  const rows = [...byListing.values()].sort((a, b) => a.listingTitle.localeCompare(b.listingTitle, "fr") || a.listingId.localeCompare(b.listingId));
  return { month, rows, totalCents: rows.reduce((s, r) => s + r.totalCents, 0) };
}

/** Audits a report export (no personal data in it). */
export async function auditTaxReportExport(actor: Authorized, month: string, rows: number) {
  await db.$transaction((tx) =>
    recordAudit(tx, { organizationId: actor.organizationId, actorId: actor.user.id, action: "tourist_tax.report_exported", targetType: "organization", targetId: actor.organizationId, details: { month, rows } }),
  );
}

