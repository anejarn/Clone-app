import { describe, expect, it } from "vitest";
import { bookingPostings, diffPostings, ownerEffect, postedTotals, postingPeriod, totalsBy, totalsOf, type LedgerAccount, type LedgerKind } from "@/lib/finance/ledger";
import { computeSplit, type SplitTerms } from "@/lib/finance/split";
import { assembleStatement, expenseReference, madToEur, StatementMismatchError, type StatementEntryInput, type StatementInput } from "@/lib/finance/statement";

/**
 * Owner statements (Lot 6b), pure part: the statement is assembled from the month's journal rows of one owner, so its
 * figures are those of the monthly overview (totalsBy owner over the same rows) to the centime; a stay across two
 * months shows its nights in the month; an adjustment after closing is its own line; the balance carries the earlier
 * months and the transfers.
 */

const terms: SplitTerms = { managementType: "MANAGED", commissionBps: 2000, cleaningBeneficiary: "SIGMA", commissionBase: "NET_EXCL_CLEANING", allocation: "NIGHTS", platformFeeBps: 1550 };
const branding = { name: "Sigma", legalName: "Sigma SARL", legalAddress: "Guéliz, Marrakech", ice: "001234567000089", rcNumber: "RC 1", taxIdNumber: "", hasLogo: false, eurRateMicros: null };

interface Row extends StatementEntryInput {
  ownerId: string | null;
}

/** The journal of a stay, posted month by month like lib/finance/post.ts (closed months → adjustments). */
function postStay(journal: Row[], opts: { bookingId: string; listingId: string; ownerId: string; checkIn: string; checkOut: string; total: number; cleaning?: number; closed?: Set<string>; source?: string }) {
  const split = computeSplit({ source: opts.source ?? "AIRBNB", status: "CONFIRMED", channelBlock: false, checkIn: opts.checkIn, checkOut: opts.checkOut, totalCents: opts.total, cleaningFeeCents: opts.cleaning ?? 20_000, platformAmount: null }, terms);
  // The taxe de séjour is posted with the booking too (its own lines): left out of this helper.
  const mine = journal.filter((r) => r.bookingId === opts.bookingId && r.account !== "TOURIST_TAX");
  const posted = postedTotals(mine.map((r) => ({ month: r.originPeriod ?? r.period, account: r.account, amountCents: r.amountCents })));
  for (const w of diffPostings(bookingPostings(split), posted)) {
    const period = postingPeriod(w.month, opts.closed ?? new Set());
    journal.push({ kind: "BOOKING", account: w.account, period, originPeriod: period === w.month ? null : w.month, amountCents: w.amountCents, listingId: opts.listingId, bookingId: opts.bookingId, expenseId: null, description: "Séjour", ownerId: opts.ownerId });
  }
  return split;
}

function row(kind: LedgerKind, account: LedgerAccount, period: string, amountCents: number, extra: Partial<Row> = {}): Row {
  return { kind, account, period, originPeriod: null, amountCents, listingId: "home-a", bookingId: null, expenseId: null, description: "", ownerId: "owner-a", ...extra };
}

function input(journal: Row[], ownerId: string, month: string, over: Partial<StatementInput> = {}): StatementInput {
  const entries = journal.filter((r) => r.ownerId === ownerId && r.period === month).map(({ ownerId: _o, ...e }) => {
    void _o;
    return e;
  });
  const previous = journal.filter((r) => r.ownerId === ownerId && r.period < month);
  return {
    branding,
    owner: { id: ownerId, name: "Hassan Benjelloun" },
    month,
    provisional: false,
    listings: [
      { id: "home-a", title: "Riad Zitoun", managementType: "MANAGED" },
      { id: "home-b", title: "Appartement Guéliz", managementType: "SUBLEASE" },
    ],
    entries,
    bookings: [
      { id: "b1", checkIn: "2026-10-30", checkOut: "2026-11-02", source: "AIRBNB", nights: 3, monthNights: { "2026-10": 2, "2026-11": 1 } },
      { id: "b2", checkIn: "2026-10-05", checkOut: "2026-10-09", source: "DIRECT", nights: 4, monthNights: { "2026-10": 4 } },
      { id: "s1", checkIn: "2026-10-10", checkOut: "2026-10-12", source: "BOOKING", nights: 2, monthNights: { "2026-10": 2 } },
    ],
    expenses: [
      { id: "exp_0000rebill", date: "2026-10-15", description: "Robinet", supplier: "Quincaillerie", hasReceipt: true },
      { id: "exp_00advance", date: "2026-10-16", description: "Ampoules", supplier: "", hasReceipt: false },
    ],
    previousNetDueCents: previous.reduce((s, r) => s + ownerEffect(r.account, r.amountCents), 0),
    previousPayoutsCents: previous.filter((r) => r.account === "OWNER_PAYOUT").reduce((s, r) => s + r.amountCents, 0),
    payouts: journal.filter((r) => r.ownerId === ownerId && r.period === month && r.account === "OWNER_PAYOUT").map((r) => ({ paidOn: `${month}-05`, reference: "VIR-1", amountCents: r.amountCents, forMonth: "2026-09", reversal: r.amountCents < 0 })),
    projectedRents: [],
    ...over,
  };
}

function october(): Row[] {
  const j: Row[] = [];
  postStay(j, { bookingId: "b1", listingId: "home-a", ownerId: "owner-a", checkIn: "2026-10-30", checkOut: "2026-11-02", total: 123_457 });
  postStay(j, { bookingId: "b2", listingId: "home-a", ownerId: "owner-a", checkIn: "2026-10-05", checkOut: "2026-10-09", total: 400_000, source: "DIRECT" });
  // Another owner's stay, same month: never on owner A's statement.
  postStay(j, { bookingId: "x1", listingId: "home-x", ownerId: "owner-b", checkIn: "2026-10-03", checkOut: "2026-10-06", total: 99_999 });
  // A sub-let stay of owner A's other home: Sigma's revenue, not listed.
  j.push(row("BOOKING", "SIGMA_RENTAL", "2026-10", 150_000, { listingId: "home-b", bookingId: "s1" }), row("BOOKING", "PLATFORM_FEE", "2026-10", 25_000, { listingId: "home-b", bookingId: "s1" }));
  j.push(row("SUBLEASE_RENT", "SUBLEASE_RENT", "2026-10", 900_000, { listingId: "home-b", description: "Loyer 10/2026" }));
  j.push(row("EXPENSE", "EXPENSE_REBILLED", "2026-10", 35_090, { expenseId: "exp_0000rebill" }));
  j.push(row("EXPENSE", "EXPENSE_OWNER_ADVANCE", "2026-10", 12_000, { expenseId: "exp_00advance" }));
  j.push(row("MANUAL_ADJUSTMENT", "OWNER_ADJUSTMENT", "2026-10", -5_000, { description: "Ajustement · geste commercial" }));
  j.push(row("BOOKING", "TOURIST_TAX", "2026-10", 6_000, { bookingId: "b2" }));
  // September: 1 000 MAD due, paid in October.
  j.push(row("MANUAL_ADJUSTMENT", "OWNER_ADJUSTMENT", "2026-09", 100_000));
  j.push(row("OWNER_PAYOUT", "OWNER_PAYOUT", "2026-10", 100_000, { listingId: null }));
  return j;
}

describe("a statement equals the monthly overview", () => {
  it("its totals are the overview's for this owner (same rows), to the centime", () => {
    const j = october();
    const s = assembleStatement(input(j, "owner-a", "2026-10"));
    const overview = totalsBy(
      j.filter((r) => r.period === "2026-10").map((r) => ({ ...r })),
      (r) => (r as Row).ownerId,
    ).get("owner-a")!;
    expect(s.totals).toEqual(overview);
    expect(s.summary.netDueCents).toBe(overview.netDueOwnerCents);
    // Owner A's net = owner share of the two stays' October parts − rebilled + advance + rent + adjustment.
    const share = j.filter((r) => r.ownerId === "owner-a" && r.period === "2026-10" && (r.account === "OWNER_SHARE" || r.account === "CLEANING_OWNER")).reduce((t, r) => t + r.amountCents, 0);
    expect(s.summary.netDueCents).toBe(share - 35_090 + 12_000 + 900_000 - 5_000);
    expect(s.summary.ownerRevenueCents + s.summary.expensesNetCents + s.summary.rentCents + s.summary.adjustmentsCents).toBe(s.summary.netDueCents);
  });

  it("each home's lines add up to its own totals and the stays' columns to their gross", () => {
    const s = assembleStatement(input(october(), "owner-a", "2026-10"));
    const a = s.listings.find((l) => l.listingId === "home-a")!;
    for (const st of a.stays) expect(st.platformFeeCents + st.cleaningCents + st.commissionCents + st.ownerShareCents).toBe(st.grossCents);
    expect(a.totals.netDueCents).toBe(a.totals.ownerShareCents + a.totals.expensesNetCents + a.totals.rentCents + a.totals.adjustmentsCents);
    expect(s.listings.reduce((t, l) => t + l.totals.netDueCents, 0)).toBe(s.summary.netDueCents);
    // No other owner's stay, no sub-let stay, no tourist tax.
    expect(s.listings.flatMap((l) => l.stays.map((x) => x.bookingId)).sort()).toEqual(["b1", "b2"]);
    const b = s.listings.find((l) => l.listingId === "home-b")!;
    expect(b.stays).toEqual([]);
    expect(b.rents).toEqual([{ description: "Loyer 10/2026", amountCents: 900_000, adjustmentOf: null }]);
  });

  it("a stay across two months shows its nights in the month and the month's share of each part", () => {
    const j = october();
    const split = computeSplit({ source: "AIRBNB", status: "CONFIRMED", channelBlock: false, checkIn: "2026-10-30", checkOut: "2026-11-02", totalCents: 123_457, cleaningFeeCents: 20_000, platformAmount: null }, terms);
    const stayOf = (month: string) => assembleStatement(input(j, "owner-a", month)).listings.find((l) => l.listingId === "home-a")!.stays.find((x) => x.bookingId === "b1")!;
    const oct = stayOf("2026-10");
    const nov = stayOf("2026-11");
    expect([oct.nightsInMonth, oct.nights, nov.nightsInMonth]).toEqual([2, 3, 1]);
    expect(oct.grossCents).toBe(split.months[0].grossCents);
    expect(oct.commissionCents).toBe(split.months[0].commissionCents);
    expect(oct.ownerShareCents + nov.ownerShareCents).toBe(split.ownerShareCents);
    expect(oct.grossCents + nov.grossCents).toBe(123_457);
  });

  it("a change after closing is its own line in the next open month, flagged with the month it corrects", () => {
    const j = october();
    postStay(j, { bookingId: "b2", listingId: "home-a", ownerId: "owner-a", checkIn: "2026-10-05", checkOut: "2026-10-09", total: 460_000, source: "DIRECT", closed: new Set(["2026-10"]) });
    const nov = assembleStatement(input(j, "owner-a", "2026-11"));
    const adj = nov.listings.find((l) => l.listingId === "home-a")!.stays.find((x) => x.bookingId === "b2")!;
    expect(adj.adjustmentOf).toBe("2026-10");
    expect(adj.grossCents).toBe(60_000);
    expect(nov.totals.adjustmentsAfterClosingCents).toBe(60_000);
    // October's statement doesn't move.
    expect(assembleStatement(input(j, "owner-a", "2026-10")).summary.netDueCents).toBe(assembleStatement(input(october(), "owner-a", "2026-10")).summary.netDueCents);
  });

  it("expenses: rebilled (−), advanced by the owner (+), each with its receipt reference", () => {
    const s = assembleStatement(input(october(), "owner-a", "2026-10"));
    const e = s.listings.find((l) => l.listingId === "home-a")!.expenses;
    expect(e.map((x) => [x.effect, x.amountCents, x.netEffectCents, x.receiptRef])).toEqual([
      ["REBILLED", 35_090, -35_090, expenseReference("exp_0000rebill")],
      ["ADVANCE", 12_000, 12_000, null],
    ]);
    expect(expenseReference("exp_0000rebill")).toBe("DEP-00REBILL");
  });

  it("balance: previous months' net due − earlier transfers, + this month − this month's transfers", () => {
    const s = assembleStatement(input(october(), "owner-a", "2026-10"));
    expect(s.summary.previousBalanceCents).toBe(100_000);
    expect(s.summary.payoutsCents).toBe(100_000);
    expect(s.summary.balanceCents).toBe(s.summary.netDueCents);
    expect(s.payouts).toEqual([{ paidOn: "2026-10-05", reference: "VIR-1", amountCents: 100_000, forMonth: "2026-09", reversal: false }]);
  });

  it("an open month's preview adds the rent closing will post, flagged « prévu », outside the net due", () => {
    const j = october().filter((r) => r.kind !== "SUBLEASE_RENT");
    const s = assembleStatement(input(j, "owner-a", "2026-10", { provisional: true, projectedRents: [{ listingId: "home-b", cents: 900_000 }] }));
    expect(s.provisional).toBe(true);
    expect(s.summary.projectedRentCents).toBe(900_000);
    expect(s.summary.balanceCents).toBe(s.summary.previousBalanceCents + s.summary.netDueCents + 900_000 - s.summary.payoutsCents);
    expect(s.listings.find((l) => l.listingId === "home-b")!.rents).toEqual([expect.objectContaining({ projected: true, amountCents: 900_000 })]);
  });

  it("refuses rows of another month and transfers that don't match the journal", () => {
    const j = october();
    expect(() => assembleStatement({ ...input(j, "owner-a", "2026-10"), entries: j.map(({ ownerId: _o, ...e }) => (void _o, e)) })).toThrow(RangeError);
    expect(() => assembleStatement({ ...input(j, "owner-a", "2026-10"), payouts: [] })).toThrow(StatementMismatchError);
  });

  it("an indicative EUR amount at the organization's rate", () => {
    expect(madToEur(1_085_000, 10_850_000)).toBe(100_000);
    expect(madToEur(-10_851, 10_850_000)).toBe(-1_000);
    expect(madToEur(5, 10_000_000)).toBe(1);
    const s = assembleStatement(input(october(), "owner-a", "2026-10", { branding: { ...branding, eurRateMicros: 10_850_000 } }));
    expect(s.summary.balanceEurCents).toBe(madToEur(s.summary.balanceCents, 10_850_000));
  });

  it("an owner without any row this month gets an empty statement carrying the balance", () => {
    const j = october();
    const s = assembleStatement(input(j, "owner-a", "2026-12"));
    expect(s.listings).toEqual([]);
    expect(s.summary.netDueCents).toBe(0);
    expect(s.summary.balanceCents).toBe(s.summary.previousBalanceCents);
    expect(s.totals).toEqual(totalsOf([]));
  });
});
