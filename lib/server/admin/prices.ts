import "server-only";
import { addDays, isoDay } from "@/lib/admin/calendar";
import type { PriceRuleInput } from "@/lib/admin/price-rule-form";
import { Prisma } from "@/lib/generated/prisma/client";
import type { PriceAdjustmentType, PriceRuleKind } from "@/lib/generated/prisma/enums";
import { priceCalendar, ruleCoversNight, type CalendarDay } from "@/lib/pricing";
import { recordAudit } from "../audit";
import type { Authorized } from "../authz";
import { db } from "../db";
import { AppError } from "../errors";
import { pricingRules, pricingRuleSelect, toPricingRule } from "../pricing";

/**
 * Prix (ADMIN only): the organization's seasons and events, and the price calendar of a home. Every function takes
 * the caller's organization (lib/server/authz.ts) and only reads or writes its rows: a rule or listing id of another
 * organization is answered 404, as an unknown one. Writes are audited in their transaction (lib/server/audit.ts).
 * A rule is configuration, not personal data: deleting one is allowed (and audited).
 */

const ruleNotFound = () => new AppError(404, "NOT_FOUND", "Règle introuvable.");
const listingNotFound = () => new AppError(404, "NOT_FOUND", "Bien introuvable.");

/** How far the price calendar looks ahead. */
export const PRICE_CALENDAR_SPANS = [30, 60, 90] as const;
export const DEFAULT_PRICE_CALENDAR_DAYS = 90;

const adminRuleSelect = {
  ...pricingRuleSelect,
  updatedAt: true,
  listings: { select: { listingId: true, listing: { select: { title: true } } }, orderBy: { listingId: "asc" } },
} satisfies Prisma.PriceRuleSelect;

type AdminRuleRow = Prisma.PriceRuleGetPayload<{ select: typeof adminRuleSelect }>;

export interface AdminPriceRule {
  id: string;
  kind: PriceRuleKind;
  name: string;
  startDate: Date;
  endDate: Date;
  recurring: boolean;
  adjustmentType: PriceAdjustmentType;
  percentBps: number | null;
  fixedCents: number | null;
  minNights: number | null;
  priority: number;
  allListings: boolean;
  listings: { id: string; title: string }[];
  createdAt: Date;
  updatedAt: Date;
}

function toAdmin(r: AdminRuleRow): AdminPriceRule {
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    startDate: r.startDate,
    endDate: r.endDate,
    recurring: r.recurring,
    adjustmentType: r.adjustmentType,
    percentBps: r.percentBps,
    fixedCents: r.fixedCents,
    minNights: r.minNights,
    priority: r.priority,
    allListings: r.allListings,
    listings: r.listings.map((l) => ({ id: l.listingId, title: l.listing.title })),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export type RulePeriod = "upcoming" | "current" | "past" | "all";

export interface PriceRuleFilters {
  kind?: PriceRuleKind;
  /** Rules that apply to this home (its own, its selections', every-home rules). */
  listingId?: string;
  /** Default "upcoming": current or later (a yearly rule always comes back). */
  period?: RulePeriod;
  /** Name, case-insensitive. */
  q?: string;
}

/** The organization's rules, filtered, by first night (yearly rules by day-month), then name. */
export async function listPriceRules(organizationId: string, filters: PriceRuleFilters, today: Date): Promise<AdminPriceRule[]> {
  const q = filters.q?.trim();
  const period = filters.period ?? "upcoming";
  const and: Prisma.PriceRuleWhereInput[] = [];
  if (filters.listingId) and.push({ OR: [{ allListings: true }, { listings: { some: { listingId: filters.listingId } } }] });
  if (period === "upcoming") and.push({ OR: [{ recurring: true }, { endDate: { gte: today } }] });
  if (period === "past") and.push({ recurring: false, endDate: { lt: today } });
  const rows = await db.priceRule.findMany({
    where: { organizationId, ...(filters.kind && { kind: filters.kind }), ...(q && { name: { contains: q, mode: "insensitive" } }), AND: and },
    select: adminRuleSelect,
    orderBy: [{ startDate: "asc" }, { name: "asc" }, { id: "asc" }],
  });
  const rules = rows.map(toAdmin);
  if (period !== "current") return rules;
  // Covering today: a yearly rule's day-month range is the engine's to check.
  const night = isoDay(today);
  return rules.filter((r) => ruleCoversNight({ startDate: isoDay(r.startDate), endDate: isoDay(r.endDate), recurring: r.recurring }, night));
}

/** One rule of the organization, or null (unknown, or another organization's). */
export async function getPriceRule(organizationId: string, id: string): Promise<AdminPriceRule | null> {
  const row = await db.priceRule.findFirst({ where: { id, organizationId }, select: adminRuleSelect });
  return row ? toAdmin(row) : null;
}

export interface RuleListingOption {
  id: string;
  title: string;
  placeName: string;
  priceCents: number;
  minNights: number;
}

/** The homes a rule can apply to (drafts included: they can be on the platforms before the site). */
export async function ruleListingOptions(organizationId: string): Promise<RuleListingOption[]> {
  const rows = await db.listing.findMany({
    where: { organizationId, category: "HOME" },
    select: { id: true, title: true, priceCents: true, minNights: true, place: { select: { name: true } } },
    orderBy: [{ place: { name: "asc" } }, { title: "asc" }, { id: "asc" }],
  });
  return rows.map(({ place, ...l }) => ({ ...l, placeName: place.name }));
}

/** The listings must all be homes of the organization: an id of another organization reads as unknown. */
async function assertListings(tx: Prisma.TransactionClient, organizationId: string, ids: string[]) {
  if (ids.length === 0) return;
  const n = await tx.listing.count({ where: { organizationId, category: "HOME", id: { in: ids } } });
  if (n !== ids.length) throw listingNotFound();
}

function ruleData(input: PriceRuleInput) {
  return {
    kind: input.kind,
    name: input.name,
    startDate: input.startDate,
    endDate: input.endDate,
    recurring: input.recurring,
    adjustmentType: input.adjustment.type,
    percentBps: input.adjustment.type === "PERCENT" ? input.adjustment.bps : null,
    fixedCents: input.adjustment.type === "FIXED" ? input.adjustment.cents : null,
    minNights: input.minNights,
    priority: input.priority,
    allListings: input.allListings,
  } satisfies Prisma.PriceRuleUncheckedUpdateInput;
}

/** What the audit trail keeps of a rule: everything, it is configuration (no personal data). */
function auditDetails(input: PriceRuleInput): Prisma.InputJsonObject {
  const d = ruleData(input);
  return {
    ...d,
    startDate: isoDay(input.startDate),
    endDate: isoDay(input.endDate),
    listingIds: input.listingIds,
  };
}

/** A rule's listings in price_rule_listings, with the organization of both foreign keys. */
const links = (organizationId: string, ruleId: string, ids: string[]) => ids.map((listingId) => ({ ruleId, listingId, organizationId }));

export async function createPriceRule(actor: Authorized, input: PriceRuleInput): Promise<{ id: string }> {
  const { organizationId } = actor;
  return db.$transaction(async (tx) => {
    await assertListings(tx, organizationId, input.listingIds);
    const rule = await tx.priceRule.create({ data: { organizationId, ...ruleData(input) }, select: { id: true } });
    if (input.listingIds.length) await tx.priceRuleListing.createMany({ data: links(organizationId, rule.id, input.listingIds) });
    await recordAudit(tx, { organizationId, actorId: actor.user.id, action: "price_rule.created", targetType: "price_rule", targetId: rule.id, details: auditDetails(input) });
    return rule;
  });
}

export async function updatePriceRule(actor: Authorized, id: string, input: PriceRuleInput): Promise<void> {
  const { organizationId } = actor;
  await db.$transaction(async (tx) => {
    const before = await tx.priceRule.findFirst({ where: { id, organizationId }, select: pricingRuleSelect });
    if (!before) throw ruleNotFound();
    await assertListings(tx, organizationId, input.listingIds);
    await tx.priceRule.update({ where: { id, organizationId }, data: ruleData(input) });
    await tx.priceRuleListing.deleteMany({ where: { ruleId: id, organizationId } });
    if (input.listingIds.length) await tx.priceRuleListing.createMany({ data: links(organizationId, id, input.listingIds) });
    await recordAudit(tx, {
      organizationId,
      actorId: actor.user.id,
      action: "price_rule.updated",
      targetType: "price_rule",
      targetId: id,
      details: { from: auditDetails(fromStored(before)), to: auditDetails(input) },
    });
  });
}

/** The stored rule in the shape of an input, for the audit trail's "from". */
function fromStored(r: Prisma.PriceRuleGetPayload<{ select: typeof pricingRuleSelect }>): PriceRuleInput {
  const p = toPricingRule(r);
  return {
    kind: r.kind,
    name: r.name,
    startDate: r.startDate,
    endDate: r.endDate,
    recurring: r.recurring,
    adjustment: p.adjustment,
    minNights: r.minNights,
    priority: r.priority,
    allListings: r.allListings,
    listingIds: p.listingIds ? [...p.listingIds] : [],
  };
}

export async function deletePriceRule(actor: Authorized, id: string): Promise<{ name: string }> {
  const { organizationId } = actor;
  return db.$transaction(async (tx) => {
    const before = await tx.priceRule.findFirst({ where: { id, organizationId }, select: pricingRuleSelect });
    if (!before) throw ruleNotFound();
    await tx.priceRule.delete({ where: { id, organizationId } });
    await recordAudit(tx, { organizationId, actorId: actor.user.id, action: "price_rule.deleted", targetType: "price_rule", targetId: id, details: auditDetails(fromStored(before)) });
    return { name: before.name };
  });
}

export interface PriceCalendarDay extends CalendarDay {
  /** A confirmed booking or owner block takes this night. */
  booked: boolean;
}

export interface PriceCalendar {
  listing: { id: string; title: string; placeName: string; priceCents: number; cleaningFeeCents: number; minNights: number; status: string };
  days: PriceCalendarDay[];
}

/**
 * A home's next `days` nights from `from`, each with its price and minimum stay as the engine computes them for the
 * site and the back-office, and whether it is taken. Null for a listing that isn't a home of the organization.
 */
export async function priceCalendarFor(organizationId: string, listingId: string, from: Date, days: number): Promise<PriceCalendar | null> {
  const listing = await db.listing.findFirst({
    where: { id: listingId, organizationId, category: "HOME" },
    select: { id: true, title: true, priceCents: true, cleaningFeeCents: true, minNights: true, status: true, place: { select: { name: true } } },
  });
  if (!listing) return null;
  const to = addDays(from, days);
  const [rules, bookings] = await Promise.all([
    pricingRules(organizationId, { from, to, listingId }),
    db.booking.findMany({
      where: { organizationId, listingId, status: "CONFIRMED", checkIn: { lt: to }, checkOut: { gt: from } },
      select: { checkIn: true, checkOut: true },
    }),
  ]);
  const taken = (night: string) => bookings.some((b) => isoDay(b.checkIn) <= night && night < isoDay(b.checkOut));
  const { place, ...l } = listing;
  return {
    listing: { ...l, placeName: place.name },
    days: priceCalendar(listing, rules, from, days).map((d) => ({ ...d, booked: taken(d.date) })),
  };
}
