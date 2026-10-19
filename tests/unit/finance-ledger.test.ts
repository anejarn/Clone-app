import { describe, expect, it } from "vitest";
import { ledgerCsv, frAmount, type LedgerExportRow } from "@/lib/finance/csv";
import { bookingPostings, diffPostings, expenseAccount, ownerEffect, postedTotals, postingKey, postingPeriod, sigmaEffect, totalsBy, totalsOf, type LedgerRow } from "@/lib/finance/ledger";
import { computeSplit, type SplitTerms } from "@/lib/finance/split";
import { parseExpense } from "@/lib/finance/expense-form";
import { prng } from "../support/prng";

const terms: SplitTerms = { managementType: "MANAGED", commissionBps: 2000, cleaningBeneficiary: "SIGMA", commissionBase: "NET_EXCL_CLEANING", allocation: "NIGHTS", platformFeeBps: 1550 };
const stay = (checkIn: string, checkOut: string, total: number, status: "CONFIRMED" | "CANCELLED" = "CONFIRMED") =>
  computeSplit({ source: "AIRBNB", status, channelBlock: false, checkIn, checkOut, totalCents: total, cleaningFeeCents: 20_000, platformAmount: null }, terms);

/** Applies the posting algorithm of lib/server/finance/post.ts in memory: closed months get adjustments. */
function post(journal: { period: string; originPeriod: string | null; account: string; amountCents: number }[], desired: Map<string, number>, closed: Set<string>) {
  const posted = postedTotals(journal.map((e) => ({ month: e.originPeriod ?? e.period, account: e.account as never, amountCents: e.amountCents })));
  const writes = diffPostings(desired as never, posted);
  for (const w of writes) {
    const period = postingPeriod(w.month, closed);
    journal.push({ period, originPeriod: period === w.month ? null : w.month, account: w.account, amountCents: w.amountCents });
  }
  return writes.length;
}

describe("posting by difference", () => {
  it("posts a split, writes nothing the second time, reverses on cancellation", () => {
    const journal: Parameters<typeof post>[0] = [];
    const s = stay("2026-10-30", "2026-11-02", 120_000);
    expect(post(journal, bookingPostings(s), new Set())).toBeGreaterThan(0);
    const n = journal.length;
    expect(post(journal, bookingPostings(s), new Set())).toBe(0);
    expect(journal).toHaveLength(n);
    expect(journal.reduce((t, e) => t + e.amountCents, 0)).toBe(120_000);
    expect(journal.filter((e) => e.period === "2026-10").reduce((t, e) => t + e.amountCents, 0)).toBe(s.months[0].grossCents);
    post(journal, bookingPostings(stay("2026-10-30", "2026-11-02", 120_000, "CANCELLED")), new Set());
    expect(journal.reduce((t, e) => t + e.amountCents, 0)).toBe(0);
  });

  it("a change after closing goes to the first open month as an adjustment; the closed month never changes", () => {
    const journal: Parameters<typeof post>[0] = [];
    post(journal, bookingPostings(stay("2026-10-30", "2026-11-02", 120_000)), new Set());
    const october = () => journal.filter((e) => e.period === "2026-10").reduce((t, e) => t + e.amountCents, 0);
    const before = october();
    const closed = new Set(["2026-10"]);
    // New price after October is closed.
    post(journal, bookingPostings(stay("2026-10-30", "2026-11-02", 150_000)), closed);
    expect(october()).toBe(before);
    const adjustments = journal.filter((e) => e.originPeriod === "2026-10");
    expect(adjustments.length).toBeGreaterThan(0);
    expect(adjustments.every((e) => e.period === "2026-11")).toBe(true);
    expect(journal.reduce((t, e) => t + e.amountCents, 0)).toBe(150_000);
    // Same again: nothing more (the adjustment counts for October).
    expect(post(journal, bookingPostings(stay("2026-10-30", "2026-11-02", 150_000)), closed)).toBe(0);
    // October and November closed: December takes the adjustment.
    post(journal, bookingPostings(stay("2026-10-30", "2026-11-02", 90_000)), new Set(["2026-10", "2026-11"]));
    expect(journal.filter((e) => e.period === "2026-12").length).toBeGreaterThan(0);
    expect(journal.reduce((t, e) => t + e.amountCents, 0)).toBe(90_000);
  });

  it("re-dating into other months moves the amounts (reversal + new months)", () => {
    const journal: Parameters<typeof post>[0] = [];
    post(journal, bookingPostings(stay("2026-10-30", "2026-11-02", 120_000)), new Set());
    post(journal, bookingPostings(stay("2026-12-01", "2026-12-04", 120_000)), new Set());
    const by = (m: string) => journal.filter((e) => e.period === m).reduce((t, e) => t + e.amountCents, 0);
    expect([by("2026-10"), by("2026-11"), by("2026-12")]).toEqual([0, 0, 120_000]);
  });

  it("taxe de séjour by month, next to the split", () => {
    const d = bookingPostings(stay("2026-10-30", "2026-11-02", 120_000), new Map([["2026-10", 6_000], ["2026-11", 3_000]]));
    expect(d.get(postingKey("2026-10", "TOURIST_TAX"))).toBe(6_000);
    expect(d.get(postingKey("2026-11", "TOURIST_TAX"))).toBe(3_000);
    expect(bookingPostings({ status: "MISSING_AMOUNT", months: [] }).size).toBe(0);
  });

  it("property: any sequence of changes and closings keeps every month's posted sums equal to the split (seed 42)", () => {
    const r = prng(42);
    for (let run = 0; run < 200; run++) {
      const journal: Parameters<typeof post>[0] = [];
      const closed = new Set<string>();
      let last = stay("2026-09-25", "2026-10-03", 100_000);
      for (let step = 0; step < 8; step++) {
        const start = Date.UTC(2026, r.int(8, 11), r.int(1, 28));
        const nights = r.int(1, 40);
        last = stay(new Date(start).toISOString().slice(0, 10), new Date(start + nights * 86_400_000).toISOString().slice(0, 10), r.int(0, 3_000_000), r.int(0, 6) === 0 ? "CANCELLED" : "CONFIRMED");
        if (r.int(0, 2) === 0) closed.add(r.pick(["2026-09", "2026-10", "2026-11", "2026-12", "2027-01"]));
        const frozen = new Map([...closed].map((m) => [m, journal.filter((e) => e.period === m).reduce((t, e) => t + e.amountCents, 0)]));
        post(journal, bookingPostings(last), closed);
        for (const [m, sum] of frozen) expect(journal.filter((e) => e.period === m).reduce((t, e) => t + e.amountCents, 0)).toBe(sum);
      }
      const byOrigin = postedTotals(journal.map((e) => ({ month: e.originPeriod ?? e.period, account: e.account as never, amountCents: e.amountCents })));
      const desired = bookingPostings(last);
      for (const k of new Set([...byOrigin.keys(), ...desired.keys()])) expect(byOrigin.get(k) ?? 0).toBe(desired.get(k) ?? 0);
    }
  });
});

describe("posting period", () => {
  it("is the month itself when open, else the first open one after it", () => {
    expect(postingPeriod("2026-10", new Set())).toBe("2026-10");
    expect(postingPeriod("2026-10", new Set(["2026-10", "2026-11"]))).toBe("2026-12");
    expect(postingPeriod("2026-12", new Set(["2026-12"]))).toBe("2027-01");
    expect(postingPeriod("2026-10", new Set(["2026-11"]))).toBe("2026-10");
  });
});

describe("owner and Sigma effects", () => {
  it("expense accounts by payer and rebilling", () => {
    expect(expenseAccount("SIGMA", true)).toBe("EXPENSE_REBILLED");
    expect(expenseAccount("SIGMA", false)).toBe("EXPENSE_SIGMA");
    expect(expenseAccount("OWNER", true)).toBe("EXPENSE_OWNER_PAID");
    expect(expenseAccount("OWNER", false)).toBe("EXPENSE_OWNER_ADVANCE");
    expect(ownerEffect("EXPENSE_REBILLED", 500)).toBe(-500);
    expect(ownerEffect("EXPENSE_OWNER_ADVANCE", 500)).toBe(500);
    expect(ownerEffect("EXPENSE_OWNER_PAID", 500)).toBe(0);
    expect(ownerEffect("EXPENSE_SIGMA", 500)).toBe(0);
    expect(sigmaEffect("EXPENSE_SIGMA", 500)).toBe(-500);
    expect(sigmaEffect("EXPENSE_OWNER_ADVANCE", 500)).toBe(-500);
    expect(ownerEffect("TOURIST_TAX", 500)).toBe(0);
    expect(sigmaEffect("TOURIST_TAX", 500)).toBe(0);
    expect(sigmaEffect("PLATFORM_FEE", 500)).toBe(0);
    expect(ownerEffect("SUBLEASE_RENT", 500)).toBe(500);
    expect(sigmaEffect("SUBLEASE_RENT", 500)).toBe(-500);
  });

  it("monthly totals: net due to the owner and Sigma's result", () => {
    const rows: LedgerRow[] = [
      { kind: "BOOKING", account: "PLATFORM_FEE", period: "2026-10", originPeriod: null, amountCents: 15_500, listingId: "a", ownerId: "o1" },
      { kind: "BOOKING", account: "CLEANING_SIGMA", period: "2026-10", originPeriod: null, amountCents: 20_000, listingId: "a", ownerId: "o1" },
      { kind: "BOOKING", account: "COMMISSION", period: "2026-10", originPeriod: null, amountCents: 12_900, listingId: "a", ownerId: "o1" },
      { kind: "BOOKING", account: "OWNER_SHARE", period: "2026-10", originPeriod: null, amountCents: 51_600, listingId: "a", ownerId: "o1" },
      { kind: "BOOKING", account: "TOURIST_TAX", period: "2026-10", originPeriod: null, amountCents: 5_000, listingId: "a", ownerId: "o1" },
      { kind: "EXPENSE", account: "EXPENSE_REBILLED", period: "2026-10", originPeriod: null, amountCents: 8_000, listingId: "a", ownerId: "o1" },
      { kind: "EXPENSE", account: "EXPENSE_OWNER_ADVANCE", period: "2026-10", originPeriod: null, amountCents: 1_000, listingId: "a", ownerId: "o1" },
      { kind: "BOOKING", account: "OWNER_SHARE", period: "2026-10", originPeriod: "2026-09", amountCents: -600, listingId: "a", ownerId: "o1" },
      { kind: "BOOKING", account: "SIGMA_RENTAL", period: "2026-10", originPeriod: null, amountCents: 70_000, listingId: "b", ownerId: "o2" },
      { kind: "SUBLEASE_RENT", account: "SUBLEASE_RENT", period: "2026-10", originPeriod: null, amountCents: 40_000, listingId: "b", ownerId: "o2" },
      { kind: "SERVICE", account: "SERVICE_MARGIN", period: "2026-10", originPeriod: null, amountCents: 3_000, listingId: "b", ownerId: "o2" },
      { kind: "SERVICE", account: "SERVICE_PARTNER_COST", period: "2026-10", originPeriod: null, amountCents: 9_000, listingId: "b", ownerId: "o2" },
      { kind: "MONTH_CLOSED", account: "NONE", period: "2026-10", originPeriod: null, amountCents: 0, listingId: null, ownerId: null },
    ];
    const byListing = totalsBy(rows, (r) => r.listingId);
    expect(byListing.get("a")).toMatchObject({ grossCents: 99_400, platformFeeCents: 15_500, commissionCents: 12_900, ownerShareCents: 51_000, touristTaxCents: 5_000, expensesRebilledCents: 8_000, ownerAdvancesCents: 1_000, adjustmentsAfterClosingCents: -600, netDueOwnerCents: 51_000 - 8_000 + 1_000, sigmaResultCents: 12_900 + 20_000 - 1_000 });
    expect(byListing.get("b")).toMatchObject({ grossCents: 70_000, subleaseRentCents: 40_000, serviceMarginCents: 3_000, netDueOwnerCents: 40_000, sigmaResultCents: 70_000 + 3_000 - 40_000 });
    const all = totalsOf(rows);
    expect(all.netDueOwnerCents).toBe(byListing.get("a")!.netDueOwnerCents + byListing.get("b")!.netDueOwnerCents);
  });
});

describe("CSV exports", () => {
  const row = (over: Partial<LedgerExportRow> = {}): LedgerExportRow => ({
    seq: 7,
    createdAt: new Date("2026-10-31T23:30:00Z"),
    period: "2026-11",
    originPeriod: "2026-10",
    kind: "BOOKING",
    account: "OWNER_SHARE",
    amountCents: -123_450,
    description: "Séjour; « Riad » =SUM(A1)",
    listingId: "l1",
    listingTitle: "Riad, Médina",
    ownerId: "o1",
    ownerName: "=cmd",
    bookingId: "b1",
    bookingRef: "HMABC",
    expenseId: null,
    serviceRequestId: null,
    reversesId: null,
    actorId: null,
    actorName: null,
    ...over,
  });
  it("French variant: BOM, « ; », JJ/MM/AAAA in Marrakech time, decimal comma, numbers never prefixed", () => {
    const csv = ledgerCsv([row()], "fr");
    expect(csv.startsWith("﻿N°;Date d'écriture;Mois comptable")).toBe(true);
    const line = csv.split("\r\n")[1];
    // 23:30 UTC on 31/10 is 00:30 on 01/11 in Marrakech (UTC+1).
    expect(line).toBe('7;01/11/2026 00:30;11/2026;10/2026;Réservation;Part propriétaire;"Séjour; « Riad » =SUM(A1)";Riad, Médina;\'=cmd;Réservation HMABC;-1234,50;-1234,50;Système');
    expect(csv.endsWith("\r\n")).toBe(true);
  });
  it("machine variant: no BOM, « , », ISO instants, centimes, codes", () => {
    const csv = ledgerCsv([row({ amountCents: 5, account: "EXPENSE_REBILLED", kind: "EXPENSE", bookingId: null, expenseId: "e1", actorId: "u1", actorName: "Amine" })], "machine");
    expect(csv.startsWith("seq,created_at,period")).toBe(true);
    expect(csv.split("\r\n")[1]).toBe('7,2026-10-31T23:30:00.000Z,2026-11,2026-10,EXPENSE,EXPENSE_REBILLED,5,-5,l1,"Riad, Médina",o1,\'=cmd,,HMABC,e1,,,u1,Amine,Séjour; « Riad » =SUM(A1)');
  });
  it("amounts with a comma and two decimals", () => {
    expect(frAmount(0)).toBe("0,00");
    expect(frAmount(5)).toBe("0,05");
    expect(frAmount(-5)).toBe("-0,05");
    expect(frAmount(123_456_789)).toBe("1234567,89");
  });
});

describe("expense form", () => {
  const ok = { listingId: "lst_1", date: "2026-10-12", category: "REPAIR", description: "Remplacement du mitigeur", supplier: "Quincaillerie Atlas", amount: "349,90", paidBy: "SIGMA", rebillToOwner: "on" };
  it("parses an expense TTC in dirhams", () => {
    expect(parseExpense(ok, { today: "2026-10-19" })).toEqual({ ok: true, input: { listingId: "lst_1", date: "2026-10-12", category: "REPAIR", description: "Remplacement du mitigeur", supplier: "Quincaillerie Atlas", amountCents: 34_990, paidBy: "SIGMA", rebillToOwner: true, ticketId: null } });
  });
  it("refuses what isn't valid", () => {
    const r = parseExpense({ listingId: "../x", date: "2026-02-30", category: "BRIBE", description: "x", supplier: "a".repeat(121), amount: "-5", paidBy: "NOBODY", ticketId: "bad id" }, { today: "2026-10-19" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.fieldErrors).sort()).toEqual(["amount", "category", "date", "description", "listingId", "paidBy", "supplier", "ticketId"]);
    const future = parseExpense({ ...ok, date: "2026-10-20" }, { today: "2026-10-19" });
    expect(future.ok).toBe(false);
    expect(parseExpense({ ...ok, amount: "0" }, { today: "2026-10-19" }).ok).toBe(false);
    expect(parseExpense({ ...ok, rebillToOwner: undefined } as never, { today: "2026-10-19" })).toMatchObject({ ok: true, input: { rebillToOwner: false } });
  });
});
