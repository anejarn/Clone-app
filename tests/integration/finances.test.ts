import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/generated/prisma/enums";

/**
 * Finances (Lot 6a) through the real server actions, routes and functions: the split stored on every booking write
 * (direct entry, new dates across two months, cancellation, a platform booking typed by hand, an amount in euros and
 * its rate), recomputed until the month is closed, adjustments after closing, the append-only journal (database
 * trigger), expenses with receipts (draft, validated, reversed, immutable), the receipt's access (associés, the home's
 * owner), breakdowns proposed as expenses, the CSV exports, and the refusals: anonymous, guest, owner, agent, associé
 * without double authentification, another organization (« introuvable »).
 *
 * Everything happens in an organization this file creates (TAG): its months can be closed without touching anyone
 * else's, and nothing depends on the order of the other files. The journal is append-only, so this file never deletes
 * its entries: they stay in its own organization (the next seed's demo reset clears the test database); its homes,
 * bookings and expenses are removed at the end.
 */
const ctx = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({
  headers: async () => ctx.headers,
  cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/cache")>()), updateTag: vi.fn(), refresh: vi.fn() }));

const act = await import("@/app/admin/finances/actions");
const { GET: exportRoute } = await import("@/app/api/admin/finances/export/route");
const { GET: receiptRoute } = await import("@/app/api/finances/expenses/[id]/receipt/route");
const { createStaffEntry, rescheduleStaffBooking, cancelStaffBooking } = await import("@/lib/server/admin/bookings");
const { parseEntryForm, parseRescheduleForm } = await import("@/lib/admin/booking-form");
const { syncBookingFinance } = await import("@/lib/finance/post");
const { syncBookingTasks } = await import("@/lib/operations/sync");
const { monthOverview } = await import("@/lib/server/finance/ledger");
const { getBookingFinance } = await import("@/lib/server/finance/bookings");
const { ticketProposals } = await import("@/lib/server/finance/expenses");
const { addMonths } = await import("@/lib/finance/months");
const { db } = await import("@/lib/server/db");
const { LocalStorage } = await import("@/lib/storage/local");
const { setFileStorage } = await import("@/lib/storage");
const { day } = await import("./helpers");
const { signedInMember } = await import("./staff");

type Authorized = import("@/lib/server/authz").Authorized;

const TAG = `F${Date.now()}`;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");

interface Member {
  headers: Headers;
  actor: Authorized;
  id: string;
}

let storeDir: string;
let org: string;
let otherOrg: string;
let admin: Member;
let otherAdmin: Member;
let ownerA: Member;
let ownerB: Member;
let home: string;
let homeB: string;
let sublet: string;
let otherHome: string;
const refused = new Map<string, Headers>();

const as = (h: Headers) => {
  ctx.headers = h;
};
function form(values: Record<string, string>, files: Record<string, Buffer> = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.append(k, v);
  for (const [k, v] of Object.entries(files)) f.append(k, new File([new Uint8Array(v)], `${k}.bin`));
  return f;
}
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

async function member(role: Role, organizationId: string | null, twoFactor = true): Promise<Member> {
  const m = await signedInMember({ role, organizationId, twoFactor, name: `${role} ${TAG}` });
  const actor: Authorized = { user: { id: m.user.id, name: m.user.name, email: m.user.email, role, twoFactorEnabled: twoFactor }, organizationId: organizationId ?? "" };
  return { headers: m.headers, actor, id: m.user.id };
}

async function makeHome(organizationId: string, ownerId: string, over: Record<string, unknown> = {}) {
  const place = await db.place.findFirstOrThrow({ where: { slug: "medina" } });
  const l = await db.listing.create({
    data: { title: `Riad finances ${TAG} ${Math.random().toString(36).slice(2, 6)}`, description: "x", organizationId, placeId: place.id, ownerId, address: `Derb ${TAG}`, lat: 31.63, lng: -7.99, maxGuests: 4, minNights: 1, priceCents: 90_000, cleaningFeeCents: 20_000, commissionBps: 2000, ...over },
  });
  return l.id;
}

async function direct(listingId: string, from: string, to: string, nightly = "1000", cleaning = "300") {
  const e = parseEntryForm("directe", { listingId, checkIn: from, checkOut: to, adults: "2", children: "0", note: "", guestName: "Lucía Fernández", guestPhone: "+34 600 000 001", channel: "WHATSAPP", nightly, cleaning });
  if (!e.ok) throw new Error(JSON.stringify(e.fieldErrors));
  return (await createStaffEntry(admin.actor, e.entry)).id;
}

/** A stay in a past month, written directly (the back-office refuses past dates), then synced like any booking write. */
async function pastStay(listingId: string, checkIn: string, checkOut: string, totalCents: number, cleaningFeeCents = 0) {
  const b = await db.booking.create({ data: { organizationId: org, listingId, source: "DIRECT", guestName: "Ancien séjour", checkIn: utc(checkIn), checkOut: utc(checkOut), adults: 2, nightlyCents: totalCents, cleaningFeeCents, serviceFeeCents: 0, totalCents } });
  await syncBookingFinance(db, b.id, { actorId: admin.id });
  return b.id;
}

const entriesOf = (where: Record<string, unknown>) => db.financialEntry.findMany({ where: { organizationId: org, ...where }, orderBy: { seq: "asc" } });
const sum = (rows: { amountCents: number }[]) => rows.reduce((t, r) => t + r.amountCents, 0);

/** The first day of a month about `days` ahead, and the days around it, so that a stay crosses two months. */
function monthBoundary(days: number) {
  const d = utc(day(days));
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  const iso = (n: number) => new Date(first.getTime() + n * 86_400_000).toISOString().slice(0, 10);
  return { iso, month: iso(0).slice(0, 7), before: iso(-1).slice(0, 7) };
}

beforeAll(async () => {
  storeDir = await mkdtemp(join(tmpdir(), "sigma-finances-"));
  setFileStorage(new LocalStorage(storeDir));
  org = (await db.organization.create({ data: { name: `Finances ${TAG}`, slug: `fin-${TAG.toLowerCase()}` } })).id;
  otherOrg = (await db.organization.create({ data: { name: `Autre ${TAG}`, slug: `fin-other-${TAG.toLowerCase()}` } })).id;
  admin = await member("ADMIN", org);
  otherAdmin = await member("ADMIN", otherOrg);
  ownerA = await member("OWNER", org, false);
  ownerB = await member("OWNER", org, false);
  home = await makeHome(org, ownerA.id);
  homeB = await makeHome(org, ownerB.id);
  sublet = await makeHome(org, ownerB.id, { managementType: "SUBLEASE", commissionBps: 0, subleaseRentCents: 900_000, subleaseRentFrom: utc("2025-01-01") });
  const otherOwner = await member("OWNER", otherOrg, false);
  otherHome = await makeHome(otherOrg, otherOwner.id);
  refused.set("anonymous", new Headers());
  refused.set("guest", (await member("GUEST", null, false)).headers);
  refused.set("owner", ownerA.headers);
  refused.set("agent", (await member("AGENT", org)).headers);
  refused.set("admin without 2FA", (await member("ADMIN", org, false)).headers);
});

beforeEach(() => as(admin.headers));

afterAll(async () => {
  // Other files count the homes outside Sigma: this file's homes go, with their bookings and expenses (validated
  // expenses are frozen: like the demo reset, this cleanup sets sigma.ledger_reset for its transaction). The journal's
  // entries stay, in this file's own organization.
  const orgs = [org, otherOrg];
  await db.$transaction([
    db.$queryRaw`SELECT set_config('sigma.ledger_reset', 'on', true)`,
    db.ownerPayout.deleteMany({ where: { organizationId: { in: orgs } } }),
    db.ownerStatement.deleteMany({ where: { organizationId: { in: orgs } } }),
    db.expense.deleteMany({ where: { organizationId: { in: orgs } } }),
    db.ticket.deleteMany({ where: { organizationId: { in: orgs } } }),
    db.booking.deleteMany({ where: { organizationId: { in: orgs } } }),
    db.listing.deleteMany({ where: { organizationId: { in: orgs } } }),
  ]);
  setFileStorage(undefined);
  await rm(storeDir, { recursive: true, force: true });
});

describe("who may touch the finances", () => {
  it("refuses every action to anonymous visitors, guests, owners, agents and an associé without double authentification", async () => {
    const bookingId = await direct(home, day(300), day(302));
    for (const [who, headers] of refused) {
      as(headers);
      const results = [
        await act.createExpenseAction({}, form({ listingId: home, date: day(-1), category: "REPAIR", description: "Pirate", amount: "10", paidBy: "SIGMA" })),
        await act.updateExpenseAction("exp_x", {}, form({})),
        await act.deleteExpenseAction("exp_x"),
        await act.validateExpenseAction("exp_x"),
        await act.reverseExpenseAction("exp_x", "raison"),
        await act.uploadReceiptAction("exp_x", form({}, { receipt: PNG })),
        await act.closeMonthAction("2025-01"),
        await act.reopenMonthAction("2025-01", "raison"),
        await act.setSplitInputsAction(bookingId, {}, form({ gross: "1" })),
        await act.reapplyTermsAction(bookingId),
        await act.saveFinanceSettingsAction({}, form({})),
        await act.saveListingTermsAction(home, {}, form({})),
        await act.addAdjustmentAction({}, form({})),
      ];
      for (const r of results) expect(r, who).toEqual({ error: expect.stringMatching(/Connectez-vous|Accès refusé|double authentification/) });
      const res = await exportRoute(new Request("http://localhost:3100/api/admin/finances/export?du=2025-01", { headers }));
      expect(res.status, who).toBe(who === "anonymous" ? 401 : 403);
    }
    expect(await db.expense.count({ where: { organizationId: org, description: "Pirate" } })).toBe(0);
    expect(await db.financeMonthClosing.count({ where: { organizationId: org } })).toBe(0);
  });

  it("another organization's associé finds nothing (« introuvable »), and exports only its own journal", async () => {
    const bookingId = await direct(home, day(304), day(306));
    as(admin.headers);
    const created = await act.createExpenseAction({}, form({ listingId: home, date: day(-1), category: "REPAIR", description: "Robinet", amount: "100", paidBy: "SIGMA", rebillToOwner: "on" }, { receipt: PNG }));
    const id = created.id!;
    as(otherAdmin.headers);
    expect(await act.setSplitInputsAction(bookingId, {}, form({ gross: "1" }))).toEqual({ error: "Réservation introuvable.", values: expect.anything() });
    expect(await act.reapplyTermsAction(bookingId)).toEqual({ error: "Réservation introuvable." });
    expect(await act.validateExpenseAction(id)).toEqual({ error: "Dépense introuvable." });
    expect(await act.deleteExpenseAction(id)).toEqual({ error: "Dépense introuvable." });
    expect(await act.updateExpenseAction(id, {}, form({ listingId: home, date: day(-1), category: "REPAIR", description: "x2", amount: "1", paidBy: "SIGMA" }))).toMatchObject({ error: "Dépense introuvable." });
    expect(await act.createExpenseAction({}, form({ listingId: home, date: day(-1), category: "REPAIR", description: "Chez les autres", amount: "1", paidBy: "SIGMA" }))).toMatchObject({ error: "Bien introuvable." });
    expect(await act.saveListingTermsAction(home, {}, form({ cleaningFeeBeneficiary: "OWNER" }))).toMatchObject({ error: "Bien introuvable." });
    expect(await act.addAdjustmentAction({}, form({ listingId: home, month: day(0).slice(0, 7), direction: "credit", amount: "10", reason: "geste" }))).toMatchObject({ error: "Bien introuvable." });
    expect(await getBookingFinance(otherOrg, bookingId)).toBeNull();
    expect((await receiptRoute(new Request("http://x/", { headers: otherAdmin.headers }), { params: Promise.resolve({ id }) })).status).toBe(404);
    const csv = await (await exportRoute(new Request(`http://localhost:3100/api/admin/finances/export?du=${day(0).slice(0, 7)}&au=${addMonths(day(0).slice(0, 7), 23)}&format=machine`, { headers: otherAdmin.headers }))).text();
    expect(csv).not.toContain(bookingId);
    expect(csv).not.toContain(home);
  });
});

describe("the split of every booking write", () => {
  it("a direct booking: stored and posted; new dates across two months share it by nights; cancelled, everything reversed", async () => {
    const m = monthBoundary(330);
    const id = await direct(home, m.iso(-3), m.iso(0));
    const f = await db.bookingFinance.findUniqueOrThrow({ where: { bookingId: id } });
    // 3 × 1 000 + 300 cleaning = 3 300 MAD; 20 % of the rent 3 000 = 600; owner 2 400; cleaning to Sigma.
    expect(f).toMatchObject({ status: "COMPLETE", grossSource: "BOOKING", feeSource: "NONE", ownerId: ownerA.id, managementType: "MANAGED", commissionBps: 2000, grossCents: 330_000, platformFeeCents: 0, cleaningSigmaCents: 30_000, commissionCents: 60_000, ownerShareCents: 240_000, version: 1 });
    let posted = await entriesOf({ bookingId: id });
    expect(sum(posted)).toBe(330_000);
    expect(posted.every((e) => e.period === m.before && e.actorId === admin.id && e.ownerId === ownerA.id && e.listingId === home)).toBe(true);

    // New dates: 30/31 → 1 of the next month (2 nights before, 1 after).
    const r = parseRescheduleForm({ checkIn: m.iso(-2), checkOut: m.iso(1) });
    if (!r.ok) throw new Error("bad dates");
    await rescheduleStaffBooking(admin.actor, id, r.input);
    const g = await db.bookingFinance.findUniqueOrThrow({ where: { bookingId: id } });
    expect(g.version).toBe(2);
    const months = g.months as { month: string; nights: number; grossCents: number; ownerShareCents: number }[];
    expect(months.map((x) => [x.month, x.nights])).toEqual([
      [m.before, 2],
      [m.month, 1],
    ]);
    expect(months.reduce((t, x) => t + x.grossCents, 0)).toBe(g.grossCents);
    posted = await entriesOf({ bookingId: id });
    expect(sum(posted.filter((e) => e.period === m.before))).toBe(months[0].grossCents);
    expect(sum(posted.filter((e) => e.period === m.month))).toBe(months[1].grossCents);
    // Recomputing without a change writes nothing (idempotent).
    const n = posted.length;
    await syncBookingTasks(db, id);
    expect(await db.financialEntry.count({ where: { bookingId: id } })).toBe(n);

    await cancelStaffBooking(admin.actor, id);
    expect(await db.bookingFinance.findUniqueOrThrow({ where: { bookingId: id } })).toMatchObject({ status: "CANCELLED", grossCents: 0, months: [] });
    posted = await entriesOf({ bookingId: id });
    expect(sum(posted)).toBe(0);
    for (const month of [m.before, m.month]) expect(sum(posted.filter((e) => e.period === month))).toBe(0);
  });

  it("a platform booking typed by hand: the fee is estimated, then the real one typed; the owner's cleaning rule of the home", async () => {
    as(admin.headers);
    expect(await act.saveListingTermsAction(homeB, {}, form({ cleaningFeeBeneficiary: "OWNER" }))).toMatchObject({ message: "Conditions du bien enregistrées." });
    const e = parseEntryForm("plateforme", { listingId: homeB, checkIn: day(340), checkOut: day(342), adults: "2", children: "0", source: "BOOKING", externalRef: `BK${TAG}`, guestName: "", guestPhone: "", guestEmail: "", total: "2000", cleaning: "200", note: "" });
    if (!e.ok) throw new Error(JSON.stringify(e.fieldErrors));
    const { id } = await createStaffEntry(admin.actor, e.entry);
    // Booking.com default 17 % of 2 000 = 340; rent 2 000 − 340 − 200 = 1 460; 20 % = 292; owner 1 168 + cleaning 200.
    expect(await db.bookingFinance.findUniqueOrThrow({ where: { bookingId: id } })).toMatchObject({ feeSource: "ESTIMATE", platformFeeBps: 1700, platformFeeCents: 34_000, cleaningOwnerCents: 20_000, cleaningSigmaCents: 0, commissionCents: 29_200, ownerShareCents: 116_800 });
    const r = await act.setSplitInputsAction(id, {}, form({ gross: "", platformFee: "300", fxRate: "", note: "Relevé Booking.com" }));
    expect(r).toMatchObject({ message: "Répartition recalculée." });
    const f = await getBookingFinance(org, id);
    expect(f).toMatchObject({ feeSource: "MANUAL", platformFeeCents: 30_000, commissionCents: 30_000, ownerShareCents: 120_000, inputs: { platformFeeCents: 30_000, note: "Relevé Booking.com" } });
    expect(sum(f!.entries)).toBe(200_000);
    expect(f!.entries.some((x) => x.account === "PLATFORM_FEE" && x.amountCents === -4_000)).toBe(true);
    expect((await db.auditLog.findFirstOrThrow({ where: { targetId: id, action: "finance.inputs_updated" } })).details).toMatchObject({ to: { platformFeeOverrideCents: 30_000 } });
    expect(await act.setSplitInputsAction(id, {}, form({ gross: "100", platformFee: "300" }))).toMatchObject({ fieldErrors: { platformFee: expect.any(String) } });
  });

  it("an amount in euros waits for the rate typed by an associé, then converts to the centime", async () => {
    const e = parseEntryForm("plateforme", { listingId: home, checkIn: day(350), checkOut: day(353), adults: "2", children: "0", source: "AGODA", externalRef: `AG${TAG}`, guestName: "", guestPhone: "", guestEmail: "", total: "", cleaning: "", note: "" });
    if (!e.ok) throw new Error(JSON.stringify(e.fieldErrors));
    const { id } = await createStaffEntry(admin.actor, e.entry);
    expect(await db.bookingFinance.findUniqueOrThrow({ where: { bookingId: id } })).toMatchObject({ status: "MISSING_AMOUNT" });
    // As if the platform's e-mail had come: 250,00 € paid out.
    await db.booking.update({ where: { id }, data: { platformAmountCents: 25_000, platformCurrency: "EUR", platformAmountKind: "PAYOUT" } });
    await syncBookingFinance(db, id);
    expect(await db.bookingFinance.findUniqueOrThrow({ where: { bookingId: id } })).toMatchObject({ status: "MISSING_RATE", foreignAmountCents: 25_000, foreignCurrency: "EUR", grossCents: 0 });
    expect(await db.financialEntry.count({ where: { bookingId: id } })).toBe(0);
    expect(await act.setSplitInputsAction(id, {}, form({ fxRate: "10,8512" }))).toMatchObject({ message: "Répartition recalculée." });
    const f = await db.bookingFinance.findUniqueOrThrow({ where: { bookingId: id } });
    // 250 € × 10,8512 = 2 712,80 MAD paid out (exact); the gross is estimated at Agoda's default 18 %.
    expect(f).toMatchObject({ status: "COMPLETE", fxRateMicros: 10_851_200, grossSource: "ESTIMATE" });
    expect(f.grossCents - f.platformFeeCents).toBe(271_280);
    expect(sum(await entriesOf({ bookingId: id }))).toBe(f.grossCents);
    expect(await act.setSplitInputsAction(id, {}, form({ fxRate: "-1" }))).toMatchObject({ fieldErrors: { fxRate: expect.any(String) } });
  });
});

describe("monthly closing", () => {
  it("only a past month closes; closing posts the sublease rents; later changes go to the next open month as adjustments; reopening is audited", async () => {
    as(admin.headers);
    expect(await act.closeMonthAction(day(0).slice(0, 7))).toEqual({ error: "Un mois se clôture une fois terminé." });
    const id = await pastStay(home, "2025-06-10", "2025-06-13", 300_000);
    const sub = await pastStay(sublet, "2025-06-20", "2025-06-22", 150_000);
    expect(await db.bookingFinance.findUniqueOrThrow({ where: { bookingId: sub } })).toMatchObject({ managementType: "SUBLEASE", sigmaRentalCents: 150_000, commissionCents: 0, ownerShareCents: 0 });
    const before = await monthOverview(org, "2025-06");
    expect(before.closed).toBe(false);
    expect(before.listings.find((l) => l.listingId === sublet)?.projectedRentCents).toBe(900_000);

    // Lot 6b: closing also generates the month's owner statements (owner A's stay, owner B's rent).
    expect(await act.closeMonthAction("2025-06")).toEqual({ message: "06/2025 clôturé (1 loyer de sous-location passé) · 2 relevés propriétaire générés." });
    expect(await act.closeMonthAction("2025-06")).toEqual({ error: "06/2025 est déjà clôturé." });
    const rent = await entriesOf({ kind: "SUBLEASE_RENT" });
    expect(rent.map((e) => [e.period, e.listingId, e.ownerId, e.amountCents])).toEqual([["2025-06", sublet, ownerB.id, 900_000]]);
    const june = await monthOverview(org, "2025-06");
    expect(june.closed).toBe(true);
    expect(june.owners.find((o) => o.ownerId === ownerB.id)?.totals).toMatchObject({ subleaseRentCents: 900_000, netDueOwnerCents: 900_000 });
    expect(june.owners.find((o) => o.ownerId === ownerA.id)?.totals).toMatchObject({ grossCents: 300_000, commissionCents: 60_000, ownerShareCents: 240_000, netDueOwnerCents: 240_000 });
    const juneSum = sum(await entriesOf({ period: "2025-06" }));

    // The stay's price changes after the closing: June never changes, July gets the difference.
    await db.booking.update({ where: { id }, data: { totalCents: 330_000, nightlyCents: 110_000 } });
    await syncBookingFinance(db, id, { actorId: admin.id });
    expect(sum(await entriesOf({ period: "2025-06" }))).toBe(juneSum);
    const adj = await entriesOf({ bookingId: id, originPeriod: "2025-06" });
    expect(adj.length).toBeGreaterThan(0);
    expect(adj.every((e) => e.period === "2025-07" && e.description.includes("ajustement après clôture de 06/2025"))).toBe(true);
    expect(sum(adj)).toBe(30_000);
    expect((await monthOverview(org, "2025-07")).totals).toMatchObject({ adjustmentsAfterClosingCents: 30_000, ownerShareCents: 24_000 });
    // Same again: nothing more. Re-closing after a reopening posts no second rent.
    await syncBookingFinance(db, id, { actorId: admin.id });
    expect((await entriesOf({ bookingId: id, originPeriod: "2025-06" })).length).toBe(adj.length);

    expect(await act.reopenMonthAction("2025-06", "")).toMatchObject({ error: expect.stringMatching(/raison/) });
    expect(await act.reopenMonthAction("2025-06", "Facture oubliée")).toEqual({ message: "06/2025 rouvert." });
    // The rent is already posted: closing again posts nothing more.
    expect(await act.closeMonthAction("2025-06")).toEqual({ message: "06/2025 clôturé." });
    expect(sum(await entriesOf({ kind: "SUBLEASE_RENT" }))).toBe(900_000);
    const markers = (await entriesOf({ account: "NONE" })).map((e) => e.kind);
    expect(markers).toEqual(["MONTH_CLOSED", "MONTH_REOPENED", "MONTH_CLOSED"]);
    expect((await db.auditLog.findMany({ where: { organizationId: org, targetType: "finance_month" }, orderBy: { createdAt: "asc" } })).map((a) => a.action)).toEqual(["finance.month_closed", "finance.month_reopened", "finance.month_closed"]);
    // A manual adjustment goes only to an open month.
    expect(await act.addAdjustmentAction({}, form({ listingId: home, month: "2025-06", direction: "credit", amount: "50", reason: "Geste" }))).toMatchObject({ error: "06/2025 est clôturé : choisissez un mois ouvert." });
    expect(await act.addAdjustmentAction({}, form({ listingId: home, month: "2025-07", direction: "debit", amount: "50", reason: "Casse" }))).toMatchObject({ message: "Ajustement passé au journal." });
    expect((await monthOverview(org, "2025-07")).owners.find((o) => o.ownerId === ownerA.id)?.totals.ownerAdjustmentsCents).toBe(-5_000);
  });

  it("the journal is append-only: the database refuses UPDATE and DELETE, even of one entry", async () => {
    const e = (await entriesOf({}))[0];
    await expect(db.financialEntry.update({ where: { id: e.id }, data: { amountCents: 1 } })).rejects.toThrow(/append-only/);
    await expect(db.financialEntry.delete({ where: { id: e.id } })).rejects.toThrow(/append-only/);
    await expect(db.$executeRaw`DELETE FROM "financial_entries" WHERE "organizationId" = ${org}`).rejects.toThrow(/append-only/);
    await expect(db.$executeRawUnsafe(`TRUNCATE "financial_entries"`)).rejects.toThrow(/append-only/);
    expect((await db.financialEntry.findUniqueOrThrow({ where: { id: e.id } })).amountCents).toBe(e.amountCents);
  });
});

describe("expenses", () => {
  it("draft with a receipt, changed, validated (posted, frozen), reversed; database refuses changes; receipt for associés and the home's owner only", async () => {
    as(admin.headers);
    expect(await act.createExpenseAction({}, form({ listingId: home, date: day(-2), category: "REPAIR", description: "Mitigeur", amount: "349,90", paidBy: "SIGMA", rebillToOwner: "on" }, { receipt: Buffer.from("not a file") }))).toMatchObject({ error: expect.stringMatching(/Format non accepté/) });
    expect(await act.createExpenseAction({}, form({ listingId: home, date: day(5), category: "REPAIR", description: "Futur", amount: "1", paidBy: "SIGMA" }))).toMatchObject({ fieldErrors: { date: expect.any(String) } });
    const c = await act.createExpenseAction({}, form({ listingId: home, date: day(-2), category: "REPAIR", description: "Mitigeur", amount: "349,90", paidBy: "SIGMA", rebillToOwner: "on" }, { receipt: PDF }));
    expect(c).toMatchObject({ message: expect.stringMatching(/brouillon/), id: expect.stringMatching(/^exp_/) });
    const id = c.id!;
    expect(await db.expense.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "DRAFT", amountCents: 34_990, receiptContentType: "application/pdf", ownerId: null });
    const receipt = (h: Headers) => receiptRoute(new Request("http://x/", { headers: h }), { params: Promise.resolve({ id }) });
    expect((await receipt(admin.headers)).status).toBe(200);
    expect((await receipt(ownerA.headers)).status).toBe(404); // a draft: not for the owner yet
    expect(await act.updateExpenseAction(id, {}, form({ listingId: home, date: day(-2), category: "REPAIR", description: "Mitigeur de douche", amount: "359,90", paidBy: "SIGMA", rebillToOwner: "on" }))).toMatchObject({ message: "Dépense modifiée." });
    expect(await act.uploadReceiptAction(id, form({}, { receipt: PNG }))).toEqual({ message: "Justificatif ajouté." });
    expect(await db.financialEntry.count({ where: { expenseId: id } })).toBe(0);

    expect(await act.validateExpenseAction(id)).toEqual({ message: `Dépense validée et passée au journal (${day(-2).slice(5, 7)}/${day(-2).slice(0, 4)}).` });
    expect(await act.validateExpenseAction(id)).toEqual({ error: "Cette dépense est déjà validée." });
    const [entry] = await entriesOf({ expenseId: id });
    expect(entry).toMatchObject({ kind: "EXPENSE", account: "EXPENSE_REBILLED", amountCents: 35_990, ownerId: ownerA.id, listingId: home, actorId: admin.id });
    const res = await receipt(ownerA.headers);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect((await receipt(ownerB.headers)).status).toBe(404);
    for (const [, h] of refused) if (h !== ownerA.headers) expect((await receipt(h)).status).toBe(404);

    expect(await act.updateExpenseAction(id, {}, form({ listingId: home, date: day(-2), category: "REPAIR", description: "Changé", amount: "1", paidBy: "SIGMA" }))).toMatchObject({ error: expect.stringMatching(/validée ne se modifie plus/) });
    expect(await act.deleteExpenseAction(id)).toMatchObject({ error: expect.stringMatching(/validée ne se modifie plus/) });
    expect(await act.uploadReceiptAction(id, form({}, { receipt: PNG }))).toMatchObject({ error: expect.stringMatching(/ne se remplace pas/) });
    await expect(db.expense.update({ where: { id }, data: { amountCents: 1 } })).rejects.toThrow(/expenses_immutable/);
    await expect(db.expense.delete({ where: { id } })).rejects.toThrow(/expenses_immutable/);
    await expect(db.expense.update({ where: { id }, data: { status: "DRAFT", validatedAt: null } })).rejects.toThrow();

    expect(await act.reverseExpenseAction(id, "")).toMatchObject({ error: expect.stringMatching(/raison/) });
    expect(await act.reverseExpenseAction(id, "Doublon de la facture")).toEqual({ message: "Dépense contre-passée." });
    expect(await act.reverseExpenseAction(id, "Encore")).toEqual({ error: "Cette dépense est déjà contre-passée." });
    const all = await entriesOf({ expenseId: id });
    expect(all.map((e) => [e.kind, e.amountCents, e.reversesId])).toEqual([
      ["EXPENSE", 35_990, null],
      ["EXPENSE_REVERSAL", -35_990, entry.id],
    ]);
    expect((await db.auditLog.findMany({ where: { targetId: id }, orderBy: { createdAt: "asc" } })).map((a) => a.action)).toEqual(["expense.created", "expense.updated", "expense.receipt_added", "expense.validated", "expense.reversed"]);
  });

  it("an expense advanced by the owner and borne by Sigma adds to the owner's net; a draft is deleted with its receipt", async () => {
    as(admin.headers);
    const c = await act.createExpenseAction({}, form({ listingId: homeB, date: day(-1), category: "PURCHASE", description: "Bouilloire", amount: "200", paidBy: "OWNER" }));
    expect(await act.validateExpenseAction(c.id!)).toMatchObject({ message: expect.any(String) });
    expect((await entriesOf({ expenseId: c.id! }))[0]).toMatchObject({ account: "EXPENSE_OWNER_ADVANCE", amountCents: 20_000, ownerId: ownerB.id });
    const month = await monthOverview(org, day(-1).slice(0, 7));
    expect(month.owners.find((o) => o.ownerId === ownerB.id)?.totals.ownerAdvancesCents).toBe(20_000);
    const d = await act.createExpenseAction({}, form({ listingId: homeB, date: day(-1), category: "SUPPLIES", description: "Piles", amount: "20", paidBy: "SIGMA" }, { receipt: PNG }));
    const key = (await db.expense.findUniqueOrThrow({ where: { id: d.id! } })).receiptKey!;
    expect(await act.deleteExpenseAction(d.id!)).toEqual({ message: "Brouillon supprimé." });
    expect(await db.expense.findUnique({ where: { id: d.id! } })).toBeNull();
    const { fileStorage } = await import("@/lib/storage");
    expect(await fileStorage().get(key)).toBeNull();
  });

  it("a breakdown « à refacturer » is proposed as an expense until one names it", async () => {
    const t = await db.ticket.create({ data: { organizationId: org, listingId: home, title: `Fuite ${TAG}`, category: "PLUMBING", costCents: 45_000, rechargeOwner: true } });
    expect((await ticketProposals(org)).map((p) => p.ticketId)).toContain(t.id);
    as(admin.headers);
    expect(await act.createExpenseAction({}, form({ listingId: homeB, date: day(-1), category: "REPAIR", description: "Fuite", amount: "450", paidBy: "SIGMA", rebillToOwner: "on", ticketId: t.id }))).toMatchObject({ error: "Panne introuvable pour ce bien." });
    expect(await act.createExpenseAction({}, form({ listingId: home, date: day(-1), category: "REPAIR", description: "Fuite", amount: "450", paidBy: "SIGMA", rebillToOwner: "on", ticketId: t.id }))).toMatchObject({ id: expect.any(String) });
    expect((await ticketProposals(org)).map((p) => p.ticketId)).not.toContain(t.id);
  });
});

describe("accounting export", () => {
  it("French CSV (BOM, « ; », JJ/MM/AAAA, decimal comma) and machine CSV, filtered, audited", async () => {
    const res = await exportRoute(new Request("http://localhost:3100/api/admin/finances/export?du=2025-06&au=2025-07", { headers: admin.headers }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toContain("journal-financier_2025-06_2025-07.csv");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes);
    const lines = text.trim().split("\r\n");
    expect(lines[0]).toContain("N°;Date d'écriture;Mois comptable");
    expect(lines.some((l) => l.includes(";06/2025;;Loyer de sous-location;") && l.includes(";9000,00;9000,00;"))).toBe(true);
    expect(lines.some((l) => l.includes(";07/2025;06/2025;Réservation;"))).toBe(true);
    expect(lines.slice(1).every((l) => /^\d+;\d{2}\/\d{2}\/\d{4} \d{2}:\d{2};\d{2}\/\d{4};/.test(l))).toBe(true);

    const m = await (await exportRoute(new Request(`http://localhost:3100/api/admin/finances/export?du=2025-06&au=2025-06&bien=${sublet}&format=machine`, { headers: admin.headers }))).text();
    const rows = m.trim().split("\r\n");
    expect(rows[0].startsWith("seq,created_at,period,origin_period,kind,account,amount_cents")).toBe(true);
    expect(rows.slice(1).every((r) => r.includes(`,${sublet},`))).toBe(true);
    expect(rows.some((r) => r.includes(",2025-06,,SUBLEASE_RENT,SUBLEASE_RENT,900000,900000,"))).toBe(true);
    expect((await exportRoute(new Request("http://localhost:3100/api/admin/finances/export?du=2025-07&au=2025-06", { headers: admin.headers }))).status).toBe(400);
    expect((await exportRoute(new Request("http://localhost:3100/api/admin/finances/export?du=2023-01&au=2025-06", { headers: admin.headers }))).status).toBe(400);
    expect(await db.auditLog.count({ where: { organizationId: org, action: "finance.exported" } })).toBe(2);
    void otherHome;
  });
});
