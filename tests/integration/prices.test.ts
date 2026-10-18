import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/generated/prisma/enums";

/**
 * Prix (Lot 2e) through the real server actions and server functions, signed in as each kind of visitor
 * (next/headers points at the test session, next/cache's request-only calls are stubbed), and the pricing engine's
 * results where prices are used: the public quote and booking, the search, the back-office's direct booking. Every
 * rule is on homes this file creates (stays from day 300), and every row is deleted at the end with the other
 * organization.
 */
const ctx = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({
  headers: async () => ctx.headers,
  cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/cache")>()), updateTag: vi.fn(), refresh: vi.fn() }));

const { createRuleAction, deleteRuleAction, updateRuleAction } = await import("@/app/admin/prix/actions");
const { getPriceRule, listPriceRules, priceCalendarFor } = await import("@/lib/server/admin/prices");
const { createStaffEntry } = await import("@/lib/server/admin/bookings");
const { parseEntryForm } = await import("@/lib/admin/booking-form");
const { createBooking, quoteStay } = await import("@/lib/server/bookings");
const { searchHomes } = await import("@/lib/server/catalog");
const { pricingRules } = await import("@/lib/server/pricing");
const { priceStay } = await import("@/lib/pricing");
const { parseSearchQuery } = await import("@/lib/search/params");
const { checkAccess } = await import("@/lib/server/authz");
const { db } = await import("@/lib/server/db");
const { day, makeUser, sigmaOrgId } = await import("./helpers");
const { signedInMember } = await import("./staff");

const sigma = await sigmaOrgId();
const TOKEN = `P${Date.now()}`;
const at = (n: number) => new Date(`${day(n)}T00:00:00Z`);

let admin: Headers;
let otherAdmin: Headers;
let otherOrg: string;
let otherListing: string;
/** 1 000 MAD a night, 200 MAD cleaning, 2-night minimum. */
let home: string;
/** 800 MAD a night, no cleaning, 1-night minimum. */
let flat: string;
const refused = new Map<string, Headers>();
const createdUsers: string[] = [];
const ownListings: string[] = [];

const as = (h: Headers) => {
  ctx.headers = h;
};

function form(values: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}

const ruleForm = (over: Record<string, string | string[]> = {}) => ({
  kind: "EVENT",
  name: `Festival ${TOKEN}`,
  startDate: day(300),
  endDate: day(302),
  adjustmentType: "PERCENT",
  percent: "+50",
  fixed: "",
  minNights: "",
  priority: "0",
  scope: "SELECTED",
  listingIds: [home],
  ...over,
});

/** Runs an action that redirects on success; returns the redirect target, or the returned state. */
async function run(fn: () => Promise<unknown>) {
  try {
    return { state: (await fn()) as { error?: string; fieldErrors?: Record<string, string> } };
  } catch (e) {
    const digest = String((e as { digest?: string }).digest ?? "");
    const to = /;(\/admin\/prix[^;]*);/.exec(digest)?.[1];
    if (!to) throw e;
    return { to };
  }
}

async function created(values: Record<string, string | string[]>) {
  const r = await run(() => createRuleAction({}, form(values)));
  const id = r.to && /cree=([^&]+)/.exec(r.to)?.[1];
  if (!id) throw new Error(`create failed: ${JSON.stringify(r.state)}`);
  return id;
}

const rulesOf = () => db.priceRule.findMany({ where: { name: { contains: TOKEN } }, include: { listings: true }, orderBy: { id: "asc" } });

async function makeHome(organizationId: string, ownerId: string, over: Record<string, unknown> = {}) {
  const place = await db.place.findFirstOrThrow({ where: { slug: "menara" } });
  const l = await db.listing.create({
    data: {
      title: `Maison prix ${TOKEN}`,
      description: "x",
      organizationId,
      placeId: place.id,
      ownerId,
      address: `Rue ${TOKEN}`,
      lat: 31.61,
      lng: -8.02,
      maxGuests: 4,
      minNights: 2,
      priceCents: 100_000,
      cleaningFeeCents: 20_000,
      ...over,
    },
  });
  ownListings.push(l.id);
  return l;
}

const stay = (listingId: string, from: number, to: number) => ({ listingId, checkIn: day(from), checkOut: day(to), adults: 2, children: 0, infants: 0, pets: 0 });

/** The engine's price for a stay, with the organization's rules as stored. */
async function engine(listingId: string, from: number, to: number) {
  const l = await db.listing.findUniqueOrThrow({ where: { id: listingId } });
  return priceStay(l, await pricingRules(sigma, { from: at(from), to: at(to), listingId }), at(from), at(to));
}

beforeAll(async () => {
  const owner = await db.user.create({ data: { name: `Owner ${TOKEN}`, email: `owner-${TOKEN.toLowerCase()}@test.sigma.test`, role: "OWNER", organizationId: sigma } });
  createdUsers.push(owner.id);
  home = (await makeHome(sigma, owner.id)).id;
  flat = (await makeHome(sigma, owner.id, { title: `Studio prix ${TOKEN}`, priceCents: 80_000, cleaningFeeCents: 0, minNights: 1 })).id;

  const a = await signedInMember({ role: "ADMIN", organizationId: sigma, twoFactor: true });
  admin = a.headers;
  createdUsers.push(a.user.id);

  otherOrg = (await db.organization.create({ data: { name: "Autre conciergerie", slug: `prix-${TOKEN.toLowerCase()}` } })).id;
  const otherOwner = await db.user.create({ data: { name: "Owner other", email: `owner-other-${TOKEN.toLowerCase()}@test.sigma.test`, role: "OWNER", organizationId: otherOrg } });
  otherListing = (await makeHome(otherOrg, otherOwner.id)).id;
  otherAdmin = (await signedInMember({ role: "ADMIN", organizationId: otherOrg, twoFactor: true })).headers;

  const personas: [string, Role | null, boolean][] = [
    ["anonymous", null, false],
    ["guest", "GUEST", false],
    ["owner", "OWNER", false],
    ["agent", "AGENT", true],
    ["admin without 2FA", "ADMIN", false],
  ];
  for (const [name, role, twoFactor] of personas) {
    if (!role) refused.set(name, new Headers());
    else {
      const m = await signedInMember({ role, organizationId: role === "GUEST" ? null : sigma, twoFactor });
      createdUsers.push(m.user.id);
      refused.set(name, m.headers);
    }
  }
});

beforeEach(() => as(admin));

afterAll(async () => {
  const ruleIds = (await db.priceRule.findMany({ where: { OR: [{ name: { contains: TOKEN } }, { organizationId: otherOrg }] }, select: { id: true } })).map((r) => r.id);
  const bookingIds = (await db.booking.findMany({ where: { listingId: { in: ownListings } }, select: { id: true } })).map((b) => b.id);
  await db.auditLog.deleteMany({ where: { OR: [{ targetId: { in: [...ruleIds, ...bookingIds] } }, { organizationId: otherOrg }] } });
  await db.priceRule.deleteMany({ where: { id: { in: ruleIds } } });
  await db.booking.deleteMany({ where: { listingId: { in: ownListings } } });
  await db.listing.deleteMany({ where: { id: { in: ownListings } } });
  await db.user.deleteMany({ where: { OR: [{ organizationId: otherOrg }, { id: { in: createdUsers } }] } });
  await db.organization.delete({ where: { id: otherOrg } });
});

describe("who may change prices", () => {
  it("every action refuses anonymous visitors, guests, owners, agents and admins without 2FA, and changes nothing", async () => {
    const id = await created(ruleForm({ name: `Refus ${TOKEN}` }));
    const before = JSON.stringify(await rulesOf());
    const expected: Record<string, string> = {
      anonymous: "Connectez-vous pour continuer.",
      guest: "Accès refusé.",
      owner: "Accès refusé.",
      agent: "Accès refusé.",
      "admin without 2FA": "Activez la double authentification pour accéder à l'espace équipe.",
    };
    for (const [name, headers] of refused) {
      as(headers);
      const want = { error: expected[name] };
      expect(await createRuleAction({}, form(ruleForm({ name: `Intrus ${TOKEN}` }))), name).toEqual(want);
      expect(await updateRuleAction(id, {}, form(ruleForm({ percent: "+400" }))), name).toEqual(want);
      expect(await deleteRuleAction(id, {}, form({ confirm: "on" })), name).toEqual(want);
    }
    expect(JSON.stringify(await rulesOf())).toBe(before);
    as(admin);
    expect((await run(() => deleteRuleAction(id, {}, form({ confirm: "on" })))).to).toBe("/admin/prix?supprime=1");
  });

  it("the Prix section is for associés only", async () => {
    for (const name of ["agent", "owner", "guest"]) expect((await checkAccess(["ADMIN"], { headers: refused.get(name)! })).ok, name).toBe(false);
  });
});

describe("organizations stay apart", () => {
  it("another organization's admin can't see, change, delete or target Sigma's rules and homes (404)", async () => {
    const id = await created(ruleForm({ name: `Isolée ${TOKEN}` }));
    as(otherAdmin);
    expect(await updateRuleAction(id, {}, form(ruleForm({ listingIds: [otherListing] })))).toMatchObject({ error: "Règle introuvable." });
    expect(await deleteRuleAction(id, {}, form({ confirm: "on" }))).toEqual({ error: "Règle introuvable." });
    expect(await createRuleAction({}, form(ruleForm({ name: `Vol ${TOKEN}`, listingIds: [home] })))).toMatchObject({ error: "Bien introuvable." });
    expect(await getPriceRule(otherOrg, id)).toBeNull();
    expect(await priceCalendarFor(otherOrg, home, at(300), 30)).toBeNull();
    expect((await listPriceRules(otherOrg, { period: "all" }, at(0))).map((r) => r.id)).not.toContain(id);
    // A rule is checked against the listings of its own organization, even mixed with one of them.
    as(admin);
    expect(await createRuleAction({}, form(ruleForm({ name: `Mélange ${TOKEN}`, listingIds: [home, otherListing] })))).toMatchObject({ error: "Bien introuvable." });
    expect((await getPriceRule(sigma, id))?.listings.map((l) => l.id)).toEqual([home]);
    // Nothing was written in the other organization's name.
    expect(await db.priceRule.count({ where: { name: { in: [`Vol ${TOKEN}`, `Mélange ${TOKEN}`] } } })).toBe(0);
    await run(() => deleteRuleAction(id, {}, form({ confirm: "on" })));
  });

  it("the database refuses a rule pointing at another organization's listing", async () => {
    const id = await created(ruleForm({ name: `Clé ${TOKEN}` }));
    await expect(db.priceRuleListing.create({ data: { ruleId: id, listingId: otherListing, organizationId: sigma } })).rejects.toThrow();
    await expect(db.priceRuleListing.create({ data: { ruleId: id, listingId: otherListing, organizationId: otherOrg } })).rejects.toThrow();
    await run(() => deleteRuleAction(id, {}, form({ confirm: "on" })));
  });

  it("another organization's rule for every home never prices Sigma's", async () => {
    await db.priceRule.create({
      data: { organizationId: otherOrg, kind: "EVENT", name: `Autre ${TOKEN}`, startDate: at(330), endDate: at(340), adjustmentType: "PERCENT", percentBps: 40_000, minNights: 30, allListings: true },
    });
    const q = await quoteStay(sigma, flat, stay(flat, 331, 333));
    expect(q).toMatchObject({ nightlyCents: 80_000, totalCents: 160_000, minNights: 1 });
  });
});

describe("creating, changing and deleting a rule", () => {
  it("is validated, stored with its listings and audited, from creation to deletion", async () => {
    const bad = await run(() => createRuleAction({}, form(ruleForm({ percent: "+900", endDate: day(299) }))));
    expect(bad.state).toMatchObject({ error: "Corrigez les champs signalés.", fieldErrors: { percent: "Pourcentage : entre -90 et +500", endDate: expect.stringMatching(/^Dernière nuit/) } });

    const id = await created(ruleForm({ name: `Cycle ${TOKEN}`, minNights: "3", priority: "5" }));
    const row = await db.priceRule.findUniqueOrThrow({ where: { id }, include: { listings: true } });
    expect(row).toMatchObject({ organizationId: sigma, kind: "EVENT", percentBps: 5_000, fixedCents: null, minNights: 3, priority: 5, allListings: false, recurring: false });
    expect(row.listings.map((l) => l.listingId)).toEqual([home]);
    const log = await db.auditLog.findFirstOrThrow({ where: { targetId: id, action: "price_rule.created" } });
    expect(log).toMatchObject({ organizationId: sigma, targetType: "price_rule" });
    expect(log.details).toMatchObject({ name: `Cycle ${TOKEN}`, percentBps: 5_000, minNights: 3, startDate: day(300), endDate: day(302), listingIds: [home] });

    expect((await run(() => updateRuleAction(id, {}, form(ruleForm({ name: `Cycle ${TOKEN}`, adjustmentType: "FIXED", fixed: "1 234,50", percent: "", listingIds: [flat] }))))).to).toBe(`/admin/prix?modifie=${id}`);
    expect(await db.priceRule.findUniqueOrThrow({ where: { id }, include: { listings: true } })).toMatchObject({ adjustmentType: "FIXED", fixedCents: 123_450, percentBps: null, listings: [{ listingId: flat }] });
    const upd = await db.auditLog.findFirstOrThrow({ where: { targetId: id, action: "price_rule.updated" } });
    expect(upd.details).toMatchObject({ from: { adjustmentType: "PERCENT", percentBps: 5_000, listingIds: [home] }, to: { adjustmentType: "FIXED", fixedCents: 123_450, listingIds: [flat] } });

    expect(await deleteRuleAction(id, {}, form({}))).toEqual({ error: "Cochez la case pour confirmer." });
    expect((await run(() => deleteRuleAction(id, {}, form({ confirm: "on" })))).to).toBe("/admin/prix?supprime=1");
    expect(await db.priceRule.findUnique({ where: { id } })).toBeNull();
    expect(await db.priceRuleListing.count({ where: { ruleId: id } })).toBe(0);
    expect((await db.auditLog.findFirstOrThrow({ where: { targetId: id, action: "price_rule.deleted" } })).details).toMatchObject({ name: `Cycle ${TOKEN}`, fixedCents: 123_450 });
    expect(await deleteRuleAction(id, {}, form({ confirm: "on" }))).toEqual({ error: "Règle introuvable." });
  });

  it("refuses a fixed price for several homes or for every home, and an unknown or malformed id", async () => {
    const r = await run(() => createRuleAction({}, form(ruleForm({ adjustmentType: "FIXED", fixed: "900", listingIds: [home, flat] }))));
    expect(r.state?.fieldErrors?.listingIds).toMatch(/un seul bien/);
    expect(await updateRuleAction("../x", {}, form(ruleForm()))).toEqual({ error: "Règle introuvable." });
    expect(await updateRuleAction("inconnue", {}, form(ruleForm()))).toMatchObject({ error: "Règle introuvable." });
  });

  it("lists rules by type, home and period", async () => {
    const id = await created(ruleForm({ name: `Liste ${TOKEN}`, kind: "SEASON", startDate: day(-10), endDate: day(-2), listingIds: [flat] }));
    const today = at(0);
    const names = async (f: Parameters<typeof listPriceRules>[1]) => (await listPriceRules(sigma, { q: TOKEN, ...f }, today)).map((r) => r.id);
    expect(await names({ period: "past" })).toContain(id);
    expect(await names({ period: "upcoming" })).not.toContain(id);
    expect(await names({ period: "all", listingId: flat, kind: "SEASON" })).toContain(id);
    expect(await names({ period: "all", listingId: home })).not.toContain(id);
    expect(await names({ period: "all", kind: "EVENT" })).not.toContain(id);
    await run(() => deleteRuleAction(id, {}, form({ confirm: "on" })));
  });

  it("the database keeps values sane", async () => {
    const base = { organizationId: sigma, kind: "SEASON" as const, name: `Base ${TOKEN}`, startDate: at(300), endDate: at(301), adjustmentType: "PERCENT" as const, percentBps: 1_000 };
    const bad: Record<string, unknown>[] = [
      { endDate: at(299) },
      { recurring: true, endDate: at(300 + 365) },
      { percentBps: -9_001 },
      { percentBps: 50_001 },
      { percentBps: null },
      { fixedCents: 10_000 },
      { adjustmentType: "FIXED", percentBps: null, fixedCents: 99 },
      { adjustmentType: "FIXED", percentBps: null, fixedCents: 10_000, allListings: true },
      { minNights: 0 },
      { priority: 101 },
      { name: " x " },
    ];
    for (const over of bad) await expect(db.priceRule.create({ data: { ...base, ...over } as never }), JSON.stringify(over)).rejects.toThrow(/price_rules_|23514/);
    const ok = await db.priceRule.create({ data: { ...base, recurring: true, endDate: at(300 + 364) } });
    await db.priceRule.delete({ where: { id: ok.id } });
  });
});

describe("prices everywhere", () => {
  it("the public quote is the engine's, event nights included", async () => {
    const id = await created(ruleForm({ name: `Quote ${TOKEN}` }));
    const q = await quoteStay(sigma, home, stay(home, 299, 304));
    expect(q.nightPrices.map((n) => n.priceCents)).toEqual([100_000, 150_000, 150_000, 150_000, 100_000]);
    expect(q).toMatchObject({ nights: 5, stayCents: 650_000, cleaningFeeCents: 20_000, serviceFeeCents: 0, totalCents: 670_000, nightlyCents: 130_000, minNights: 2 });
    const e = await engine(home, 299, 304);
    expect(q.totalCents).toBe(e.totalCents);
    // A season for the same home (same reach), even with a higher priority, gives way to the event on its nights.
    const season = await created(ruleForm({ name: `Saison ${TOKEN}`, kind: "SEASON", percent: "-20", priority: "100", startDate: day(298), endDate: day(305) }));
    const q2 = await quoteStay(sigma, home, stay(home, 297, 301));
    expect(q2.nightPrices.map((n) => n.priceCents)).toEqual([100_000, 80_000, 80_000, 150_000]);
    expect(q2.totalCents).toBe((await engine(home, 297, 301)).totalCents);
    for (const r of [id, season]) await run(() => deleteRuleAction(r, {}, form({ confirm: "on" })));
    expect((await quoteStay(sigma, home, stay(home, 299, 304))).totalCents).toBe(520_000);
  });

  it("booking is refused under the stay's minimum raised by a rule, and stores the average and the exact total", async () => {
    const id = await created(ruleForm({ name: `Minimum ${TOKEN}`, startDate: day(310), endDate: day(312), percent: "+10", minNights: "4" }));
    const guest = await makeUser("Prix");
    createdUsers.push(guest.id);
    await expect(createBooking(sigma, guest.id, stay(home, 309, 311))).rejects.toMatchObject({ status: 422, code: "MIN_NIGHTS", message: "Ce logement se réserve pour 4 nuits minimum." });
    // Not touching the rule: the listing's own minimum (2).
    await expect(quoteStay(sigma, home, stay(home, 313, 315))).resolves.toMatchObject({ minNights: 2 });
    const b = await createBooking(sigma, guest.id, stay(home, 309, 313));
    // 1 000 + 1 100 × 3 = 4 300 MAD, + 200 cleaning.
    expect(b).toMatchObject({ nightlyCents: 107_500, cleaningFeeCents: 20_000, serviceFeeCents: 0, totalCents: 450_000 });
    await run(() => deleteRuleAction(id, {}, form({ confirm: "on" })));
  });

  it("search only shows homes whose minimum stay (raised by rules) fits the dates, priced like the quote", async () => {
    const search = (from: number, to: number) => searchHomes(sigma, "menara", parseSearchQuery({ checkin: day(from), checkout: day(to), adults: "2", pinned: home }));
    const shown = async (from: number, to: number) => (await search(from, to)).cards.some((c) => c.id === home);
    // The listing's own 2-night minimum: refused for 1 night (the Lot 1 gap), shown for 2.
    expect(await shown(320, 321)).toBe(false);
    expect(await shown(320, 322)).toBe(true);
    const id = await created(ruleForm({ name: `Recherche ${TOKEN}`, startDate: day(321), endDate: day(321), percent: "+20", minNights: "3" }));
    expect(await shown(320, 322)).toBe(false);
    expect(await shown(320, 323)).toBe(true);
    // Not touching the rule's night.
    expect(await shown(322, 324)).toBe(true);
    // The card's total is the quote's: 1 000 + 1 200 + 1 000 + 200.
    const card = (await search(320, 323)).cards.find((c) => c.id === home)!;
    const q = await quoteStay(sigma, home, stay(home, 320, 323));
    expect(q.totalCents).toBe(340_000);
    expect(card.price).toBe("3 400 MAD");
    // A minimum-only rule for every home of the organization hides them all for a shorter stay; then it's gone.
    const all = await db.priceRule.create({
      data: { organizationId: sigma, kind: "EVENT", name: `Tous ${TOKEN}`, startDate: at(325), endDate: at(325), adjustmentType: "PERCENT", percentBps: 0, minNights: 7, allListings: true },
    });
    expect((await search(325, 327)).total).toBe(0);
    await db.priceRule.delete({ where: { id: all.id } });
    expect(await shown(325, 327)).toBe(true);
    await run(() => deleteRuleAction(id, {}, form({ confirm: "on" })));
  });

  it("a direct booking typed by the team is priced by the engine, unless a price is typed; the rule's minimum applies", async () => {
    const id = await created(ruleForm({ name: `Saisie ${TOKEN}`, startDate: day(341), endDate: day(345), percent: "-25", minNights: "3", listingIds: [flat] }));
    const entry = (from: number, to: number, over: Record<string, string> = {}) => {
      const p = parseEntryForm("directe", { listingId: flat, checkIn: day(from), checkOut: day(to), adults: "1", guestName: "Yassine El Amrani", guestPhone: "+212 6 12 34 56 78", channel: "PHONE", nightly: "", cleaning: "", ...over });
      if (!p.ok) throw new Error(JSON.stringify(p.fieldErrors));
      return p.entry;
    };
    const actor = { user: { id: "staff", name: "A", email: "a@test", role: "ADMIN" as const, twoFactorEnabled: true }, organizationId: sigma };
    await expect(createStaffEntry(actor, entry(340, 342))).rejects.toMatchObject({ code: "MIN_NIGHTS", message: expect.stringContaining("3 nuits minimum") });
    const { id: b1 } = await createStaffEntry(actor, entry(340, 343));
    // 800 + 600 + 600.
    expect(await db.booking.findUniqueOrThrow({ where: { id: b1 } })).toMatchObject({ totalCents: 200_000, nightlyCents: 66_667, cleaningFeeCents: 0 });
    expect((await engine(flat, 340, 343)).totalCents).toBe(200_000);
    // A negotiated price: every night at it; the short stay accepted by the team, noted in the audit trail.
    await expect(createStaffEntry(actor, entry(344, 345, { nightly: "700" }))).rejects.toMatchObject({ code: "MIN_NIGHTS" });
    const { id: b2 } = await createStaffEntry(actor, entry(344, 345, { nightly: "700", allowShortStay: "on" }));
    expect(await db.booking.findUniqueOrThrow({ where: { id: b2 } })).toMatchObject({ totalCents: 70_000, nightlyCents: 70_000 });
    expect((await db.auditLog.findFirstOrThrow({ where: { targetId: b2 } })).details).toMatchObject({ shortStayAccepted: true, minNights: 3, priceOverridden: true });
    await run(() => deleteRuleAction(id, {}, form({ confirm: "on" })));
  });

  it("the price calendar shows each night's price, rule, minimum stay and bookings", async () => {
    const id = await created(ruleForm({ name: `Calendrier ${TOKEN}`, startDate: day(351), endDate: day(352), percent: "+30", minNights: "3" }));
    const guest = await makeUser("Cal");
    createdUsers.push(guest.id);
    await createBooking(sigma, guest.id, stay(home, 354, 356));
    const cal = (await priceCalendarFor(sigma, home, at(350), 7))!;
    expect(cal.days.map((d) => [d.date, d.priceCents, d.minNights, d.rule?.name ?? null, d.booked])).toEqual([
      [day(350), 100_000, 2, null, false],
      [day(351), 130_000, 3, `Calendrier ${TOKEN}`, false],
      [day(352), 130_000, 3, `Calendrier ${TOKEN}`, false],
      [day(353), 100_000, 2, null, false],
      [day(354), 100_000, 2, null, true],
      [day(355), 100_000, 2, null, true],
      [day(356), 100_000, 2, null, false],
    ]);
    await run(() => deleteRuleAction(id, {}, form({ confirm: "on" })));
  });
});
