import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/generated/prisma/enums";

/**
 * Owner statements and the owner portal (Lot 6b) through the real server actions, routes and functions: statements
 * generated at closing (figures = the monthly overview's, to the centime), stored with their SHA-256, versioned and
 * immutable (database trigger), regenerated only when asked or when their figures changed, a provisional preview for
 * an open month; transfers to owners posted to the journal and audited; the statements' header; documents shared with
 * an owner; and the portal's isolation: an owner never reads another owner's homes, bookings, figures, statements,
 * documents or receipts — nor another organization's — even with the right ids (404 / null), and anonymous visitors,
 * guests, agents and associés don't get the portal.
 *
 * Everything happens in organizations this file creates (TAG), in fixed past months of its own; it removes its homes,
 * bookings, expenses, statements, transfers and documents at the end (statements and transfers are immutable: like
 * the demo reset, the cleanup sets sigma.ledger_reset for its transaction). Its accounts go with
 * tests/integration/cleanup-accounts.ts.
 */
const ctx = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({
  headers: async () => ctx.headers,
  cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/cache")>()), updateTag: vi.fn(), refresh: vi.fn() }));

const act = await import("@/app/admin/finances/actions");
const userActs = await import("@/app/admin/utilisateurs/actions");
const { GET: statementRoute } = await import("@/app/api/finances/statements/[id]/route");
const { GET: previewRoute } = await import("@/app/api/admin/finances/statements/apercu/route");
const { GET: monthPdfRoute } = await import("@/app/api/admin/finances/statements/mois/route");
const { GET: documentRoute } = await import("@/app/api/owner-documents/[id]/route");
const { GET: receiptRoute } = await import("@/app/api/finances/expenses/[id]/receipt/route");
const { GET: langRoute } = await import("@/app/proprietaire/langue/route");
const { syncBookingFinance } = await import("@/lib/finance/post");
const { monthOverview } = await import("@/lib/server/finance/ledger");
const statements = await import("@/lib/server/finance/statements");
const portal = await import("@/lib/server/owner/portal");
const { listOwnerDocuments } = await import("@/lib/server/owner/documents");
const { checkAccess, requireOwnerPage } = await import("@/lib/server/authz");
const { localMonth } = await import("@/lib/finance/months");
const { formatAmount } = await import("@/lib/finance/statement-pdf");
const { db } = await import("@/lib/server/db");
const { LocalStorage } = await import("@/lib/storage/local");
const { fileStorage, setFileStorage } = await import("@/lib/storage");
const { day } = await import("./helpers");
const { signedInMember } = await import("./staff");
const { pdfText } = await import("../support/pdf-text");

type Authorized = import("@/lib/server/authz").Authorized;

const TAG = `P${Date.now()}`;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
const M1 = "2025-03";
const M2 = "2025-04";
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

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
let agent: Member;
let guest: Member;
let ownerA: Member;
let ownerB: Member;
let ownerC: Member;
let homeA: string;
let subletA: string;
let homeB: string;
let homeC: string;
let expenseA: string;
let expenseB: string;

const as = (h: Headers) => {
  ctx.headers = h;
};
function form(values: Record<string, string>, files: Record<string, Buffer> = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.append(k, v);
  for (const [k, v] of Object.entries(files)) f.append(k, new File([new Uint8Array(v)], `${k}.bin`));
  return f;
}

async function member(role: Role, organizationId: string | null, twoFactor = role === "ADMIN" || role === "AGENT"): Promise<Member> {
  const m = await signedInMember({ role, organizationId, twoFactor, name: `${role} ${TAG}` });
  const actor: Authorized = { user: { id: m.user.id, name: m.user.name, email: m.user.email, role, twoFactorEnabled: twoFactor }, organizationId: organizationId ?? "" };
  return { headers: m.headers, actor, id: m.user.id };
}

async function makeHome(organizationId: string, ownerId: string, title: string, over: Record<string, unknown> = {}) {
  const place = await db.place.findFirstOrThrow({ where: { slug: "medina" } });
  const l = await db.listing.create({
    data: { title: `${title} ${TAG}`, description: "x", organizationId, placeId: place.id, ownerId, address: `Derb ${TAG}`, lat: 31.63, lng: -7.99, maxGuests: 4, minNights: 1, priceCents: 90_000, cleaningFeeCents: 20_000, commissionBps: 2000, ...over },
  });
  return l.id;
}

/** A stay written directly (the back-office refuses past dates), then synced like any booking write. */
async function stay(organizationId: string, listingId: string, checkIn: string, checkOut: string, totalCents: number, source: "DIRECT" | "AIRBNB" = "DIRECT", cleaningFeeCents = 20_000) {
  const b = await db.booking.create({
    data: { organizationId, listingId, source, externalRef: source === "DIRECT" ? null : `HM${Math.random().toString(36).slice(2, 10).toUpperCase()}`, guestName: "Voyageuse Privée", guestPhone: "+33 6 00 00 00 99", checkIn: utc(checkIn), checkOut: utc(checkOut), adults: 2, nightlyCents: totalCents, cleaningFeeCents, serviceFeeCents: 0, totalCents },
  });
  await syncBookingFinance(db, b.id, { actorId: admin.id });
  return b.id;
}

async function expense(listingId: string, date: string, description: string, amount: string) {
  as(admin.headers);
  const r = await act.createExpenseAction({}, form({ listingId, date, category: "REPAIR", description, amount, paidBy: "SIGMA", rebillToOwner: "on" }, { receipt: PNG }));
  if (!r.id) throw new Error(JSON.stringify(r));
  expect(await act.validateExpenseAction(r.id)).toMatchObject({ message: expect.stringContaining("validée") });
  return r.id;
}

const req = (url: string, headers: Headers = new Headers()) => new Request(`http://localhost:3100${url}`, { headers });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const latest = (ownerId: string, month: string) => db.ownerStatement.findFirstOrThrow({ where: { organizationId: org, ownerId, month }, orderBy: { version: "desc" } });

/** What a Next.js redirect()/notFound() threw, or "ok". */
async function outcome(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "ok";
  } catch (e) {
    const digest = String((e as { digest?: string }).digest ?? e);
    if (digest.startsWith("NEXT_REDIRECT")) return `redirect ${digest.split(";")[2]}`;
    if (digest.includes(";404")) return "404";
    throw e;
  }
}

beforeAll(async () => {
  storeDir = await mkdtemp(join(tmpdir(), "sigma-owner-portal-"));
  setFileStorage(new LocalStorage(storeDir));
  org = (await db.organization.create({ data: { name: `Portail ${TAG}`, slug: `portal-${TAG.toLowerCase()}` } })).id;
  otherOrg = (await db.organization.create({ data: { name: `Autre ${TAG}`, slug: `portal-other-${TAG.toLowerCase()}` } })).id;
  admin = await member("ADMIN", org);
  otherAdmin = await member("ADMIN", otherOrg);
  agent = await member("AGENT", org);
  guest = await member("GUEST", null);
  ownerA = await member("OWNER", org);
  ownerB = await member("OWNER", org);
  ownerC = await member("OWNER", otherOrg);
  homeA = await makeHome(org, ownerA.id, "Riad A");
  subletA = await makeHome(org, ownerA.id, "Studio A", { managementType: "SUBLEASE", commissionBps: 0, subleaseRentCents: 600_000, subleaseRentFrom: utc("2025-01-01") });
  homeB = await makeHome(org, ownerB.id, "Riad B");
  homeC = await makeHome(otherOrg, ownerC.id, "Riad C");

  // March: owner A has a stay across March and April, a stay inside March, a sub-let stay (Sigma's) and its rent at
  // closing, a rebilled expense; owner B one stay; owner C (other organization) one stay.
  await stay(org, homeA, "2025-03-30", "2025-04-02", 123_457, "AIRBNB");
  await stay(org, homeA, "2025-03-10", "2025-03-14", 400_000);
  await stay(org, subletA, "2025-03-20", "2025-03-22", 150_000);
  await stay(org, homeB, "2025-03-05", "2025-03-08", 210_000);
  await stay(otherOrg, homeC, "2025-03-05", "2025-03-08", 330_000);
  expenseA = await expense(homeA, "2025-03-15", `Robinet ${TAG}`, "349,90");
  expenseB = await expense(homeB, "2025-03-16", `Serrure ${TAG}`, "120");
  // Upcoming stays and an owner block for the dashboards.
  await db.booking.create({ data: { organizationId: org, listingId: homeA, source: "DIRECT", guestName: "Inès Secret", guestPhone: "+212 600 000 001", checkIn: utc(day(500)), checkOut: utc(day(503)), adults: 2, nightlyCents: 1, cleaningFeeCents: 0, serviceFeeCents: 0, totalCents: 3 } });
  await db.booking.create({ data: { organizationId: org, listingId: homeA, source: "OWNER", checkIn: utc(day(510)), checkOut: utc(day(512)), adults: 0 } });
  await db.booking.create({ data: { organizationId: org, listingId: homeB, source: "DIRECT", guestName: "Bob Caché", guestPhone: "+212 600 000 002", checkIn: utc(day(505)), checkOut: utc(day(507)), adults: 1, nightlyCents: 1, cleaningFeeCents: 0, serviceFeeCents: 0, totalCents: 2 } });
});

beforeEach(() => as(admin.headers));

afterAll(async () => {
  const orgs = [org, otherOrg];
  await db.$transaction([
    db.$queryRaw`SELECT set_config('sigma.ledger_reset', 'on', true)`,
    db.ownerPayout.deleteMany({ where: { organizationId: { in: orgs } } }),
    db.ownerStatement.deleteMany({ where: { organizationId: { in: orgs } } }),
    db.ownerDocument.deleteMany({ where: { organizationId: { in: orgs } } }),
    db.expense.deleteMany({ where: { organizationId: { in: orgs } } }),
    db.booking.deleteMany({ where: { organizationId: { in: orgs } } }),
    db.listing.deleteMany({ where: { organizationId: { in: orgs } } }),
  ]);
  setFileStorage(undefined);
  await rm(storeDir, { recursive: true, force: true });
});

describe("statements at closing", () => {
  it("an open month has a provisional preview only; closing generates every owner's statement, equal to the overview to the centime", async () => {
    // Open month: preview with « Provisoire », no stored statement.
    const preview = await previewRoute(req(`/api/admin/finances/statements/apercu?mois=${M1}&proprietaire=${ownerA.id}`, admin.headers));
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-type")).toBe("application/pdf");
    const previewText = pdfText(new Uint8Array(await preview.arrayBuffer()));
    expect(previewText).toContain("PROVISOIRE");
    expect(previewText).toContain("Loyer de sous-location du mois (passé à la clôture)");
    await expect(statements.generateStatement(admin.actor, ownerA.id, M1)).rejects.toMatchObject({ code: "MONTH_OPEN" });
    expect(await act.generateStatementsAction(M1)).toEqual({ error: expect.stringContaining("n'est pas clôturé") });

    expect(await act.closeMonthAction(M1)).toEqual({ message: "03/2025 clôturé (1 loyer de sous-location passé) · 2 relevés propriétaire générés." });
    const overview = await monthOverview(org, M1);
    for (const owner of [ownerA, ownerB]) {
      const s = await latest(owner.id, M1);
      const data = s.data as unknown as import("@/lib/finance/statement").StatementData;
      const o = overview.owners.find((w) => w.ownerId === owner.id)!;
      expect(s.version).toBe(1);
      expect(data.provisional).toBe(false);
      expect(data.totals).toEqual(o.totals);
      expect(s.netDueCents).toBe(o.totals.netDueOwnerCents);
      for (const l of data.listings.filter((x) => x.managementType === "MANAGED")) {
        const ol = overview.listings.find((x) => x.listingId === l.listingId)!;
        expect(l.totals.netDueCents).toBe(ol.totals.netDueOwnerCents);
        expect(l.totals.grossCents).toBe(ol.totals.grossCents);
        expect(l.totals.commissionCents).toBe(ol.totals.commissionCents);
        expect(l.totals.platformFeeCents).toBe(ol.totals.platformFeeCents);
        expect(l.totals.ownerShareCents).toBe(ol.totals.ownerShareCents + ol.totals.cleaningOwnerCents);
      }
      // The stored PDF is the one hashed, and prints the overview's net due.
      const file = (await fileStorage().get(s.fileKey))!;
      expect(sha(file.bytes)).toBe(s.sha256);
      const text = pdfText(file.bytes);
      expect(text).toContain(`${formatAmount(o.totals.netDueOwnerCents)} MAD`);
      expect(text).not.toContain("PROVISOIRE");
      expect(text).not.toContain("Voyageuse Privée");
    }
    const a = (await latest(ownerA.id, M1)).data as unknown as import("@/lib/finance/statement").StatementData;
    const cross = a.listings.find((l) => l.listingId === homeA)!.stays.find((x) => x.checkIn === "2025-03-30")!;
    expect([cross.nightsInMonth, cross.nights]).toEqual([2, 3]);
    expect(a.listings.find((l) => l.listingId === subletA)!.stays).toEqual([]);
    expect(a.listings.find((l) => l.listingId === subletA)!.rents.map((r) => r.amountCents)).toEqual([600_000]);
    expect(a.listings.find((l) => l.listingId === homeA)!.expenses).toEqual([expect.objectContaining({ expenseId: expenseA, amountCents: 34_990, netEffectCents: -34_990, receiptRef: expect.stringMatching(/^DEP-/) })]);
    // Owner C's organization has no statement from this closing.
    expect(await db.ownerStatement.count({ where: { organizationId: otherOrg } })).toBe(0);
    expect(await db.auditLog.count({ where: { organizationId: org, action: "statement.generated" } })).toBe(2);
  });

  it("statements are immutable; generating again writes nothing new, « Nouvelle version » writes v2 and keeps v1", async () => {
    const v1 = await latest(ownerA.id, M1);
    await expect(db.ownerStatement.update({ where: { id: v1.id }, data: { netDueCents: 1 } })).rejects.toThrow(/owner_statements_immutable/);
    await expect(db.ownerStatement.delete({ where: { id: v1.id } })).rejects.toThrow(/owner_statements_immutable/);
    expect(await act.generateStatementsAction(M1)).toEqual({ message: "0 relevé généré, 2 inchangés." });
    expect(await act.regenerateStatementAction(ownerA.id, M1)).toEqual({ message: "Relevé 03/2025 : version 2 générée." });
    const v2 = await latest(ownerA.id, M1);
    expect(v2.version).toBe(2);
    expect(v2.fileKey).not.toBe(v1.fileKey);
    expect(v2.dataHash).toBe(v1.dataHash);
    const old = await statementRoute(req(`/api/finances/statements/${v1.id}`, admin.headers), params(v1.id));
    expect(old.status).toBe(200);
    expect(sha(new Uint8Array(await old.arrayBuffer()))).toBe(v1.sha256);
  });

  it("a reopened month changed and closed again gets a new version for the owner whose figures changed only", async () => {
    expect(await act.reopenMonthAction(M1, "Geste commercial oublié")).toEqual({ message: "03/2025 rouvert." });
    expect(await act.addAdjustmentAction({}, form({ listingId: homeA, month: M1, direction: "credit", amount: "250", reason: "Geste commercial" }))).toMatchObject({ message: expect.any(String) });
    expect(await act.closeMonthAction(M1)).toEqual({ message: "03/2025 clôturé · 1 relevé propriétaire généré." });
    const a = await latest(ownerA.id, M1);
    expect(a.version).toBe(3);
    expect((a.data as unknown as { summary: { adjustmentsCents: number } }).summary.adjustmentsCents).toBe(25_000);
    expect((await latest(ownerB.id, M1)).version).toBe(1);
    expect(a.netDueCents).toBe((await monthOverview(org, M1)).owners.find((w) => w.ownerId === ownerA.id)!.totals.netDueOwnerCents);
  });

  it("the month's statements in one PDF, for associés", async () => {
    const res = await monthPdfRoute(req(`/api/admin/finances/statements/mois?mois=${M1}`, admin.headers));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("attachment");
    const text = pdfText(new Uint8Array(await res.arrayBuffer()));
    expect(text).toContain(ownerA.actor.user.name);
    expect(text).toContain("version 3");
    expect((await monthPdfRoute(req(`/api/admin/finances/statements/mois?mois=${M1}`, agent.headers))).status).toBe(403);
    expect((await monthPdfRoute(req(`/api/admin/finances/statements/mois?mois=${M1}`, otherAdmin.headers))).status).toBe(404);
  });
});

describe("transfers to owners (« Virement effectué »)", () => {
  it("is posted to the journal in the month of its date, audited, never changed, reversible once", async () => {
    const statement = await latest(ownerA.id, M1);
    const today = day(0);
    const current = localMonth(new Date());
    const before = await monthOverview(org, current);
    expect(await act.recordPayoutAction(ownerA.id, M1, {}, form({ paidOn: day(30), reference: "VIR-1", amount: "100" }))).toMatchObject({ error: "La date du virement ne peut pas être dans le futur." });
    expect(await act.recordPayoutAction(ownerA.id, M1, {}, form({ paidOn: today, reference: "", amount: "100" }))).toMatchObject({ fieldErrors: { reference: expect.any(String) } });
    expect(await act.recordPayoutAction(ownerA.id, "2025-06", {}, form({ paidOn: today, reference: "VIR-0", amount: "100" }))).toMatchObject({ error: "Générez d'abord le relevé de 06/2025." });
    expect(await act.recordPayoutAction(ownerC.id, M1, {}, form({ paidOn: today, reference: "VIR-0", amount: "100" }))).toMatchObject({ error: "Propriétaire introuvable." });
    as(agent.headers);
    expect(await act.recordPayoutAction(ownerA.id, M1, {}, form({ paidOn: today, reference: "VIR-0", amount: "100" }))).toMatchObject({ error: expect.stringMatching(/Accès refusé/) });
    as(admin.headers);

    const amount = statement.balanceCents;
    const balanceBefore = (await portal.ownerDashboard({ userId: ownerA.id, organizationId: org })).balanceCents;
    expect(await act.recordPayoutAction(ownerA.id, M1, {}, form({ paidOn: today, reference: `VIR-${TAG}`, amount: formatAmount(amount).replace(/ /g, "") }))).toMatchObject({ message: "Virement enregistré et passé au journal." });
    const payout = await db.ownerPayout.findFirstOrThrow({ where: { organizationId: org, ownerId: ownerA.id } });
    expect(payout).toMatchObject({ month: M1, amountCents: amount, reference: `VIR-${TAG}`, statementId: statement.id, reversedAt: null });
    const entry = await db.financialEntry.findUniqueOrThrow({ where: { id: payout.entryId } });
    expect(entry).toMatchObject({ kind: "OWNER_PAYOUT", account: "OWNER_PAYOUT", period: current, amountCents: amount, ownerId: ownerA.id, actorId: admin.id });
    expect(await db.auditLog.count({ where: { organizationId: org, action: "owner_payout.recorded", targetId: payout.id } })).toBe(1);
    // The transfer pays the net due, it doesn't change it.
    const after = await monthOverview(org, current);
    const ow = (o: typeof after) => o.owners.find((w) => w.ownerId === ownerA.id)?.totals;
    expect(ow(after)?.netDueOwnerCents ?? 0).toBe(ow(before)?.netDueOwnerCents ?? 0);
    expect(ow(after)?.ownerPayoutsCents).toBe(amount);
    await expect(db.ownerPayout.update({ where: { id: payout.id }, data: { amountCents: 1 } })).rejects.toThrow(/owner_payouts_immutable/);
    await expect(db.ownerPayout.delete({ where: { id: payout.id } })).rejects.toThrow(/owner_payouts_immutable/);
    expect((await statements.ownerStatementList(org, ownerA.id))[0].payouts).toEqual([expect.objectContaining({ id: payout.id, amountCents: amount, reversed: null })]);
    // The portal's balance: everything due so far (later months included), minus the transfers.
    expect((await portal.ownerDashboard({ userId: ownerA.id, organizationId: org })).balanceCents).toBe(balanceBefore - amount);

    expect(await act.reversePayoutAction(payout.id, "x")).toEqual({ error: expect.stringContaining("raison") });
    expect(await act.reversePayoutAction(payout.id, "Montant erroné")).toEqual({ message: expect.stringContaining("annulé") });
    expect(await act.reversePayoutAction(payout.id, "Encore")).toEqual({ error: "Ce virement est déjà annulé." });
    const reversed = await db.ownerPayout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(await db.financialEntry.findUniqueOrThrow({ where: { id: reversed.reversalEntryId! } })).toMatchObject({ amountCents: -amount, reversesId: payout.entryId });
    await expect(db.ownerPayout.update({ where: { id: payout.id }, data: { reversalReason: "autre" } })).rejects.toThrow(/owner_payouts_immutable/);
    expect((await portal.ownerDashboard({ userId: ownerA.id, organizationId: org })).balanceCents).toBe(balanceBefore);
  });

  it("the next month's statement carries the balance of the months before", async () => {
    expect(await act.closeMonthAction(M2)).toMatchObject({ message: expect.stringContaining("04/2025 clôturé") });
    const march = await latest(ownerA.id, M1);
    const april = (await latest(ownerA.id, M2)).data as unknown as import("@/lib/finance/statement").StatementData;
    expect(april.summary.previousBalanceCents).toBe(march.balanceCents);
    // The April night of the stay across months is on April's statement.
    expect(april.listings.find((l) => l.listingId === homeA)!.stays.map((s) => [s.checkIn, s.nightsInMonth, s.nights])).toEqual([["2025-03-30", 1, 3]]);
  });
});

describe("statements' header (organization parameters)", () => {
  it("validates the ICE and the rate, stores the logo, and the next version prints them", async () => {
    expect(await act.saveBrandingAction({}, form({ legalName: "Sigma SARL", ice: "123", eurRate: "" }))).toMatchObject({ error: "L'ICE compte 15 chiffres." });
    expect(await act.saveBrandingAction({}, form({ legalName: "Sigma SARL", ice: "", eurRate: "abc" }))).toMatchObject({ fieldErrors: { eurRate: expect.any(String) } });
    expect(await act.saveBrandingAction({}, form({ legalName: "Sigma SARL", legalAddress: "Guéliz, Marrakech", ice: "001 234 567 000 089", rcNumber: "RC Marrakech 1", taxIdNumber: "IF 2", eurRate: "10,85" }, { logo: PNG }))).toMatchObject({ message: expect.any(String) });
    const o = await db.organization.findUniqueOrThrow({ where: { id: org } });
    expect(o).toMatchObject({ legalName: "Sigma SARL", ice: "001234567000089", statementEurRateMicros: 10_850_000, logoKey: expect.stringMatching(/^branding\//) });
    expect(await act.generateStatementsAction(M2)).toEqual({ message: "2 relevés générés." });
    const text = pdfText((await fileStorage().get((await latest(ownerB.id, M2)).fileKey))!.bytes);
    expect(text).toContain("ICE : 001234567000089");
    expect(text).toContain("EUR, à titre indicatif");
    expect(await db.auditLog.count({ where: { organizationId: org, action: "organization.branding_updated" } })).toBe(1);
  });
});

describe("documents shared with an owner", () => {
  it("an associé uploads (checked type, owner and home of the organization), the owner downloads, the associé deletes", async () => {
    as(agent.headers);
    expect(await userActs.addOwnerDocumentAction(ownerA.id, {}, form({ kind: "MANDATE", title: "Mandat" }, { file: PDF }))).toMatchObject({ error: expect.stringMatching(/Accès refusé/) });
    as(admin.headers);
    expect(await userActs.addOwnerDocumentAction(ownerA.id, {}, form({ kind: "MANDATE", title: "Mandat" }, { file: Buffer.from("not a pdf") }))).toMatchObject({ error: expect.stringContaining("Format non accepté") });
    expect(await userActs.addOwnerDocumentAction(ownerC.id, {}, form({ kind: "MANDATE", title: "Mandat" }, { file: PDF }))).toMatchObject({ error: "Propriétaire introuvable." });
    expect(await userActs.addOwnerDocumentAction(ownerA.id, {}, form({ kind: "MANDATE", title: "Mandat", listingId: homeB }, { file: PDF }))).toMatchObject({ error: "Bien introuvable pour ce propriétaire." });
    expect(await userActs.addOwnerDocumentAction(ownerA.id, {}, form({ kind: "MANDATE", title: `Mandat de gestion ${TAG}`, listingId: homeA }, { file: PDF }))).toMatchObject({ message: expect.any(String) });
    expect(await userActs.addOwnerDocumentAction(ownerB.id, {}, form({ kind: "LICENSE", title: `Autorisation B ${TAG}` }, { file: PNG }))).toMatchObject({ message: expect.any(String) });
    const [docA] = await listOwnerDocuments(org, ownerA.id);
    expect(docA).toMatchObject({ kind: "MANDATE", listingId: homeA, contentType: "application/pdf" });
    expect(await db.auditLog.count({ where: { organizationId: org, action: "owner_document.added" } })).toBe(2);
    const ok = await documentRoute(req(`/api/owner-documents/${docA.id}`, ownerA.headers), params(docA.id));
    expect(ok.status).toBe(200);
    expect(Buffer.from(await ok.arrayBuffer()).equals(PDF)).toBe(true);
    expect((await documentRoute(req(`/api/owner-documents/${docA.id}`, admin.headers), params(docA.id))).status).toBe(200);
  });
});

describe("the owner portal: each owner sees their own data only", () => {
  const A = () => ({ userId: ownerA.id, organizationId: org });
  const B = () => ({ userId: ownerB.id, organizationId: org });

  it("homes and bookings: their own, never another owner's or organization's (null as for an unknown id); no guest name", async () => {
    expect((await portal.ownerListings(A())).map((l) => l.id).sort()).toEqual([homeA, subletA].sort());
    expect((await portal.ownerListings(B())).map((l) => l.id)).toEqual([homeB]);
    expect(await portal.ownerListing(A(), homeB)).toBeNull();
    expect(await portal.ownerListing(A(), homeC)).toBeNull();
    expect(await portal.ownerListing(A(), "nope")).toBeNull();
    expect(await portal.ownerListingBookings(A(), homeB)).toBeNull();
    expect(await portal.ownerListingBookings(A(), homeC)).toBeNull();
    expect(await portal.ownerListingBookings({ userId: ownerC.id, organizationId: org }, homeA)).toBeNull();
    const bookings = (await portal.ownerListingBookings(A(), homeA, { from: "2025-01-01", to: day(600) }))!;
    expect(bookings.map((b) => b.kind)).toEqual(["STAY", "STAY", "STAY", "OWNER_BLOCK"]);
    expect(JSON.stringify(bookings)).not.toMatch(/Inès|Secret|\+212|Voyageuse/);
    const dash = await portal.ownerDashboard(A());
    expect(dash.listings).toBe(2);
    expect(JSON.stringify(dash)).not.toContain(homeB);
    expect(JSON.stringify(dash)).not.toMatch(/Bob|Inès/);
  });

  it("figures and statements: their own; another owner's statement is 404 for every role but its owner and the associés", async () => {
    const figures = await portal.ownerMonthlyFigures(A(), new Date("2025-04-20T12:00:00Z"));
    const march = figures.find((f) => f.month === M1)!;
    const sA = await latest(ownerA.id, M1);
    expect(march).toMatchObject({ closed: true, statementId: sA.id });
    expect(march.totals.netDueOwnerCents).toBe(sA.netDueCents);
    expect((await statements.ownerStatementList(org, ownerB.id)).every((s) => s.id !== sA.id)).toBe(true);

    const sB = await latest(ownerB.id, M1);
    const get = (id: string, h: Headers) => statementRoute(req(`/api/finances/statements/${id}`, h), params(id));
    const own = await get(sA.id, ownerA.headers);
    expect(own.status).toBe(200);
    expect(own.headers.get("content-type")).toBe("application/pdf");
    expect(own.headers.get("cache-control")).toContain("no-store");
    expect(sha(new Uint8Array(await own.arrayBuffer()))).toBe(sA.sha256);
    expect((await get(sA.id, admin.headers)).status).toBe(200);
    for (const [who, h] of [
      ["owner B", ownerB.headers],
      ["owner of another organization", ownerC.headers],
      ["associé of another organization", otherAdmin.headers],
      ["agent", agent.headers],
      ["guest", guest.headers],
      ["anonymous", new Headers()],
    ] as const) {
      expect((await get(sA.id, h)).status, who).toBe(404);
    }
    expect((await get(sB.id, ownerA.headers)).status).toBe(404);
    expect((await get("unknown-id", ownerA.headers)).status).toBe(404);
    expect(await statements.statementDetail({ userId: ownerA.id, role: "OWNER", organizationId: org }, sB.id)).toBeNull();
    expect(await statements.statementDetail({ userId: ownerC.id, role: "OWNER", organizationId: otherOrg }, sA.id)).toBeNull();
    expect((await statements.statementDetail({ userId: ownerA.id, role: "OWNER", organizationId: org }, sA.id))?.versions.map((v) => v.version)).toEqual([3, 2, 1]);
    // Previews are for associés only.
    expect((await previewRoute(req(`/api/admin/finances/statements/apercu?mois=${M1}&proprietaire=${ownerA.id}`, ownerA.headers))).status).toBe(403);
    expect((await previewRoute(req(`/api/admin/finances/statements/apercu?mois=${M1}&proprietaire=${ownerC.id}`, admin.headers))).status).toBe(404);
  });

  it("documents and receipts: their own; another owner's are 404", async () => {
    const [docA] = await listOwnerDocuments(org, ownerA.id);
    const [docB] = await listOwnerDocuments(org, ownerB.id);
    const doc = (id: string, h: Headers) => documentRoute(req(`/api/owner-documents/${id}`, h), params(id));
    expect((await doc(docB.id, ownerB.headers)).status).toBe(200);
    for (const h of [ownerB.headers, ownerC.headers, otherAdmin.headers, agent.headers, guest.headers, new Headers()]) expect((await doc(docA.id, h)).status).toBe(404);
    expect((await listOwnerDocuments(org, ownerA.id)).map((d) => d.id)).toEqual([docA.id]);
    expect((await listOwnerDocuments(otherOrg, ownerA.id))).toEqual([]);

    expect((await portal.ownerReceipts(A())).map((r) => r.expenseId)).toEqual([expenseA]);
    expect((await portal.ownerReceipts(B())).map((r) => r.expenseId)).toEqual([expenseB]);
    const receipt = (id: string, h: Headers) => receiptRoute(req(`/api/finances/expenses/${id}/receipt`, h), params(id));
    expect((await receipt(expenseA, ownerA.headers)).status).toBe(200);
    expect((await receipt(expenseA, ownerB.headers)).status).toBe(404);
    expect((await receipt(expenseA, ownerC.headers)).status).toBe(404);

    // Deleting: audited, the file is gone, the owner gets 404.
    expect(await userActs.deleteOwnerDocumentAction(docA.id)).toEqual({ message: "Document supprimé." });
    expect((await doc(docA.id, ownerA.headers)).status).toBe(404);
    expect(await db.auditLog.count({ where: { organizationId: org, action: "owner_document.deleted", targetId: docA.id } })).toBe(1);
    as(otherAdmin.headers);
    expect(await userActs.deleteOwnerDocumentAction(docB.id)).toEqual({ error: "Document introuvable." });
  });

  it("the portal's pages: owners only (anonymous → login, every other role → 404), double authentification optional", async () => {
    expect(await outcome(() => requireOwnerPage("/proprietaire/releves", { headers: new Headers() }))).toBe("redirect /login?next=%2Fproprietaire%2Freleves");
    for (const m of [guest, agent, admin]) expect(await outcome(() => requireOwnerPage("/proprietaire", { headers: m.headers }))).toBe("404");
    expect(await outcome(() => requireOwnerPage("/proprietaire", { headers: ownerA.headers }))).toBe("ok");
    expect(await checkAccess(["OWNER"], { headers: ownerA.headers })).toMatchObject({ ok: true, organizationId: org, user: { id: ownerA.id, twoFactorEnabled: false } });
    // Owners never get the back-office.
    expect(await checkAccess(["ADMIN", "AGENT"], { headers: ownerA.headers })).toEqual({ ok: false, reason: "FORBIDDEN" });
  });

  it("the language switch keeps the choice in a cookie and only goes back to portal pages", async () => {
    const r = await langRoute(req("/proprietaire/langue?l=ar&retour=/proprietaire/releves"));
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("http://localhost:3100/proprietaire/releves");
    expect(r.headers.get("set-cookie")).toContain("sigma_owner_lang=ar");
    expect((await langRoute(req("/proprietaire/langue?l=ar&retour=https://evil.example/"))).headers.get("location")).toBe("http://localhost:3100/proprietaire");
    expect((await langRoute(req("/proprietaire/langue?l=ar&retour=//evil.example/proprietaire"))).headers.get("location")).toBe("http://localhost:3100/proprietaire");
    expect((await langRoute(req("/proprietaire/langue?l=xx"))).headers.get("set-cookie")).toBeNull();
  });
});
