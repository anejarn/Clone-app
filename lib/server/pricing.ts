import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { PricingRule } from "@/lib/pricing";
import { isoNight } from "@/lib/pricing";
import { db } from "./db";

/**
 * Price rules (table price_rules) as the pricing engine reads them (lib/pricing/engine.ts). Every read takes the
 * organization: a rule never prices another organization's listing (and the composite foreign keys of
 * price_rule_listings keep a rule's listings in its organization).
 */

export const pricingRuleSelect = {
  id: true,
  kind: true,
  name: true,
  startDate: true,
  endDate: true,
  recurring: true,
  adjustmentType: true,
  percentBps: true,
  fixedCents: true,
  minNights: true,
  priority: true,
  allListings: true,
  createdAt: true,
  listings: { select: { listingId: true }, orderBy: { listingId: "asc" } },
} satisfies Prisma.PriceRuleSelect;

export type PricingRuleRow = Prisma.PriceRuleGetPayload<{ select: typeof pricingRuleSelect }>;

export function toPricingRule(r: PricingRuleRow): PricingRule {
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    startDate: isoNight(r.startDate),
    endDate: isoNight(r.endDate),
    recurring: r.recurring,
    adjustment: r.adjustmentType === "FIXED" ? { type: "FIXED", cents: r.fixedCents ?? 0 } : { type: "PERCENT", bps: r.percentBps ?? 0 },
    minNights: r.minNights,
    priority: r.priority,
    listingIds: r.allListings ? null : r.listings.map((l) => l.listingId),
    createdAt: r.createdAt.toISOString(),
  };
}

export interface RuleScope {
  /** Nights from `from` to `to` − 1 (checkout exclusive). */
  from: Date;
  to: Date;
  /** Only the rules that can apply to this listing (all listings, or it among theirs). */
  listingId?: string;
  /** Only the rules that raise the minimum stay above this number of nights. */
  minNightsAbove?: number;
}

/**
 * The organization's rules that may cover a night of [from, to): one-off rules overlapping it, and every yearly
 * rule (the engine checks their day-month range). A rule's listing ids are all of them (the engine needs their
 * count for precedence), not only `listingId`.
 */
export async function pricingRules(organizationId: string, scope: RuleScope, tx: Prisma.TransactionClient = db): Promise<PricingRule[]> {
  const rows = await tx.priceRule.findMany({
    where: {
      organizationId,
      OR: [{ recurring: true }, { startDate: { lt: scope.to }, endDate: { gte: scope.from } }],
      ...(scope.listingId && { AND: [{ OR: [{ allListings: true }, { listings: { some: { listingId: scope.listingId } } }] }] }),
      ...(scope.minNightsAbove !== undefined && { minNights: { gt: scope.minNightsAbove } }),
    },
    select: pricingRuleSelect,
    orderBy: { id: "asc" },
  });
  return rows.map(toPricingRule);
}
