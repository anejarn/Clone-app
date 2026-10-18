import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/generated/prisma/enums";

/**
 * Calendrier and Réservations (Lot 2d) through the real server actions and server functions, signed in as each kind
 * of visitor: next/headers is pointed at the test session, next/cache's request-only calls are stubbed. Every row
 * is on homes this file creates (dates from day 220), and is deleted at the end with the other organization.
 */
const ctx = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({
  headers: async () => ctx.headers,
  cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/cache")>()), updateTag: vi.fn(), refresh: vi.fn() }));

const { cancelBookingAction, createEntryAction, rescheduleBookingAction } = await import("@/app/admin/reservations/actions");
const { calendarData, cancelStaffBooking, createStaffEntry, getStaffBooking, listStaffBookings } = await import("@/lib/server/admin/bookings");
const { canSeeBookingAmounts, canWriteBookings } = await import("@/lib/admin/sections");
const { parseEntryForm } = await import("@/lib/admin/booking-form");
const { checkAccess } = await import("@/lib/server/authz");
const { bookedRanges } = await import("@/lib/server/catalog");
const { db } = await import("@/lib/server/db");
const { day, sigmaOrgId } = await import("./helpers");
const { signedInMember } = await import("./staff");

const sigma = await sigmaOrgId();
const TOKEN = `B${Date.now()}`;
const at = (n: number) => new Date(`${day(n)}T00:00:00Z`);

let admin: Headers;
let adminId: string;
let agent: Headers;
let otherAdmin: Headers;
let otherOrg: string;
let otherListing: string;
let home: string;
let villa: string;
const refused = new Map<string, Headers>();
const createdUsers: string[] = [];
const ownListings: string[] = [];

const as = (h: Headers) => {
  ctx.headers = h;
};

function form(values: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.append(k, v);
  return f;
}

const directForm = (listingId: string, from: number, to: number, over: Record<string, string> = {}) => ({
  listingId,
  checkIn: day(from),
  checkOut: day(to),
  adults: "2",
  children: "0",
  guestName: "Yassine El Amrani",
  guestPhone: "+212 6 12 34 56 78",
  guestEmail: "",
  channel: "PHONE",
  nightly: "",
  cleaning: "",
  note: "Arrivée tardive",
  ...over,
});
const platformForm = (listingId: string, from: number, to: number, over: Record<string, string> = {}) => ({
  listingId,
  checkIn: day(from),
  checkOut: day(to),
  adults: "1",
  source: "AIRBNB",
  externalRef: `HM${TOKEN.slice(-8)}${Math.floor(Math.random() * 1e4)}`,
  ...over,
});
const blockForm = (listingId: string, from: number, to: number, over: Record<string, string> = {}) => ({
  listingId,
  checkIn: day(from),
  checkOut: day(to),
  note: "Séjour du propriétaire",
  ...over,
});

type Kind = "directe" | "plateforme" | "blocage";

/** Runs the create action; returns the new id from its redirect, or the returned state. */
async function create(kind: Kind, values: Record<string, string>) {
  try {
    return { state: await createEntryAction(kind, {}, form(values)) };
  } catch (e) {
    const digest = String((e as { digest?: string }).digest ?? "");
    const id = /\/admin\/reservations\/([^?;]+)\?cree=/.exec(digest)?.[1];
    if (!id) throw e;
    return { id };
  }
}

async function created(kind: Kind, values: Record<string, string>) {
  const r = await create(kind, values);
  if (!r.id) throw new Error(`create failed: ${JSON.stringify(r.state)}`);
  return r.id;
}

async function makeHome(organizationId: string, ownerId: string, over: Record<string, unknown> = {}) {
  const place = await db.place.findFirstOrThrow({ where: { slug: "medina" } });
  const l = await db.listing.create({
    data: {
      title: `Riad réservations ${TOKEN}`,
      description: "x",
      organizationId,
      placeId: place.id,
      ownerId,
      address: `Derb ${TOKEN}`,
      lat: 31.63,
      lng: -7.99,
      maxGuests: 4,
      minNights: 3,
      priceCents: 100_000,
      cleaningFeeCents: 20_000,
      ...over,
    },
  });
  ownListings.push(l.id);
  return l.id;
}

const bookingsOf = (listingId: string) => db.booking.findMany({ where: { listingId }, orderBy: { id: "asc" } });

beforeAll(async () => {
  const owner = await db.user.create({ data: { name: `Owner ${TOKEN}`, email: `owner-${TOKEN.toLowerCase()}@test.sigma.test`, role: "OWNER", organizationId: sigma } });
  createdUsers.push(owner.id);
  home = await makeHome(sigma, owner.id);
  villa = await makeHome(sigma, owner.id, { title: `Villa réservations ${TOKEN}`, minNights: 1, maxGuests: 8, priceCents: 250_050, cleaningFeeCents: 0 });

  const a = await signedInMember({ role: "ADMIN", organizationId: sigma, twoFactor: true, name: `Admin ${TOKEN}` });
  admin = a.headers;
  adminId = a.user.id;
  const g = await signedInMember({ role: "AGENT", organizationId: sigma, twoFactor: true });
  agent = g.headers;
  createdUsers.push(a.user.id, g.user.id);

  otherOrg = (await db.organization.create({ data: { name: "Autre conciergerie", slug: `resa-${TOKEN.toLowerCase()}` } })).id;
  const otherOwner = await db.user.create({ data: { name: "Owner other", email: `owner-other-${TOKEN.toLowerCase()}@test.sigma.test`, role: "OWNER", organizationId: otherOrg } });
  otherListing = await makeHome(otherOrg, otherOwner.id, { minNights: 1 });
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
  const ids = (await db.booking.findMany({ where: { listingId: { in: ownListings } }, select: { id: true } })).map((b) => b.id);
  await db.auditLog.deleteMany({ where: { OR: [{ targetId: { in: ids } }, { organizationId: otherOrg }] } });
  await db.booking.deleteMany({ where: { listingId: { in: ownListings } } });
  await db.listing.deleteMany({ where: { id: { in: ownListings } } });
  await db.user.deleteMany({ where: { OR: [{ organizationId: otherOrg }, { id: { in: createdUsers } }] } });
  await db.organization.delete({ where: { id: otherOrg } });
});

describe("who may write bookings", () => {
  it("every action refuses anonymous visitors, guests, owners, agents and admins without 2FA, and changes nothing", async () => {
    const id = await created("directe", directForm(villa, 220, 223));
    const before = JSON.stringify(await bookingsOf(villa));
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
      expect(await createEntryAction("directe", {}, form(directForm(villa, 230, 232))), name).toEqual(want);
      expect(await createEntryAction("plateforme", {}, form(platformForm(villa, 233, 235))), name).toEqual(want);
      expect(await createEntryAction("blocage", {}, form(blockForm(villa, 236, 240))), name).toEqual(want);
      expect(await rescheduleBookingAction(id, {}, form({ checkIn: day(224), checkOut: day(226) })), name).toEqual(want);
      expect(await cancelBookingAction(id, {}, form({ confirm: "on" })), name).toEqual(want);
    }
    expect(JSON.stringify(await bookingsOf(villa))).toBe(before);
  });

  it("agents read the bookings without amounts; associés write and see them", async () => {
    expect([canWriteBookings("ADMIN"), canWriteBookings("AGENT"), canWriteBookings("OWNER")]).toEqual([true, false, false]);
    expect([canSeeBookingAmounts("ADMIN"), canSeeBookingAmounts("AGENT")]).toEqual([true, false]);
    expect(await checkAccess(["ADMIN", "AGENT"], { headers: agent })).toMatchObject({ ok: true, user: { role: "AGENT" } });
  });
});

describe("a direct booking typed by an associé", () => {
  it("is priced at the listing's nightly price × nights + cleaning, with the guest's contact and the channel, and audited", async () => {
    const id = await created("directe", directForm(home, 240, 244, { channel: "WHATSAPP", guestEmail: "yassine@exemple.ma", children: "1" }));
    const b = await db.booking.findUniqueOrThrow({ where: { id } });
    expect(b).toMatchObject({
      organizationId: sigma,
      source: "DIRECT",
      guestId: null,
      guestName: "Yassine El Amrani",
      guestPhone: "+212 6 12 34 56 78",
      guestEmail: "yassine@exemple.ma",
      channel: "WHATSAPP",
      note: "Arrivée tardive",
      adults: 2,
      children: 1,
      nightlyCents: 100_000,
      cleaningFeeCents: 20_000,
      serviceFeeCents: 0,
      totalCents: 420_000,
      status: "CONFIRMED",
      checkIn: at(240),
      checkOut: at(244),
    });
    const [log] = await db.auditLog.findMany({ where: { targetId: id } });
    expect(log).toMatchObject({ organizationId: sigma, actorId: adminId, action: "booking.created", targetType: "booking" });
    expect(log.details).toMatchObject({ source: "DIRECT", channel: "WHATSAPP", nights: 4, totalCents: 420_000, priceOverridden: false });
    // No guest contact in the audit trail.
    expect(JSON.stringify(log.details)).not.toMatch(/Yassine|212|exemple/);
  });

  it("takes a negotiated nightly price or cleaning fee, and refuses a free stay", async () => {
    const id = await created("directe", directForm(villa, 250, 252, { nightly: "1 800", cleaning: "150,50" }));
    expect(await db.booking.findUniqueOrThrow({ where: { id } })).toMatchObject({ nightlyCents: 180_000, cleaningFeeCents: 15_050, totalCents: 375_050 });
    const free = await create("directe", directForm(villa, 253, 254, { nightly: "0" }));
    expect(free.state).toMatchObject({ error: "Le total d'une réservation directe doit être supérieur à 0 MAD." });
  });

  it("respects the minimum stay unless the associé accepts a shorter one, which is noted", async () => {
    const short = await create("directe", directForm(home, 260, 262));
    expect(short.state).toMatchObject({ error: expect.stringContaining("Ce logement se réserve pour 3 nuits minimum. Cochez « Accepter un séjour plus court »") });
    expect(short.state?.values).toMatchObject({ guestName: "Yassine El Amrani", checkIn: day(260) });
    const id = await created("directe", directForm(home, 260, 262, { allowShortStay: "on" }));
    expect((await db.auditLog.findFirstOrThrow({ where: { targetId: id } })).details).toMatchObject({ shortStayAccepted: true, minNights: 3 });
  });

  it("checks the form and the listing's capacity", async () => {
    const r = await create("directe", directForm(home, 270, 274, { guestName: "", guestPhone: "", adults: "0" }));
    expect(r.state?.error).toBe("Corrigez les champs signalés.");
    expect(Object.keys(r.state?.fieldErrors ?? {}).sort()).toEqual(["adults", "guestName", "guestPhone"]);
    expect((await create("directe", directForm(home, 270, 274, { adults: "4", children: "1" }))).state).toMatchObject({
      error: "Ce logement accueille 4 voyageurs au maximum (adultes et enfants).",
    });
    expect((await create("directe", directForm(home, 274, 270))).state?.fieldErrors).toEqual({ checkOut: "Départ : après l'arrivée" });
    expect(await db.booking.count({ where: { listingId: home, checkIn: at(270) } })).toBe(0);
  });

  it("refuses a stay already over or more than two years ahead", async () => {
    const access = { user: { id: adminId, name: "A", email: "a", role: "ADMIN" as const, twoFactorEnabled: true }, organizationId: sigma };
    const entry = (from: number, to: number) => {
      const p = parseEntryForm("blocage", blockForm(villa, from, to));
      if (!p.ok) throw new Error("bad form");
      return p.entry;
    };
    await expect(createStaffEntry(access, entry(280, 282), at(282))).rejects.toMatchObject({ status: 422, message: expect.stringContaining("déjà terminé") });
    await expect(createStaffEntry(access, entry(280, 282), at(281))).resolves.toMatchObject({ id: expect.any(String) });
    await expect(createStaffEntry(access, entry(300, 302), at(300 - 731))).rejects.toMatchObject({ message: "L'arrivée ne peut pas être plus de deux ans à l'avance." });
  });
});

describe("a platform booking typed by hand", () => {
  it("needs its platform and code; the amount is optional", async () => {
    const missing = await create("plateforme", platformForm(villa, 300, 303, { externalRef: "" }));
    expect(missing.state?.fieldErrors).toMatchObject({ externalRef: "Référence de la plateforme : champ obligatoire" });
    expect((await create("plateforme", platformForm(villa, 300, 303, { source: "DIRECT" }))).state?.fieldErrors).toHaveProperty("source");

    const id = await created("plateforme", platformForm(villa, 300, 303, { externalRef: `HMNOAMOUNT${TOKEN.slice(-4)}`, guestName: "Emma de Jong" }));
    expect(await db.booking.findUniqueOrThrow({ where: { id } })).toMatchObject({
      source: "AIRBNB",
      externalRef: `HMNOAMOUNT${TOKEN.slice(-4)}`,
      guestName: "Emma de Jong",
      channel: null,
      totalCents: null,
      nightlyCents: null,
    });
    const paid = await created("plateforme", platformForm(villa, 303, 306, { source: "BOOKING", externalRef: `${Date.now()}`, total: "4 000", cleaning: "300" }));
    expect(await db.booking.findUniqueOrThrow({ where: { id: paid } })).toMatchObject({ source: "BOOKING", totalCents: 400_000, cleaningFeeCents: 30_000, nightlyCents: 123_333 });
  });

  it("refuses a code already recorded for that platform in the organization, not in another one", async () => {
    const ref = `HMDUP${TOKEN.slice(-6)}`;
    await created("plateforme", platformForm(villa, 310, 312, { externalRef: ref }));
    expect((await create("plateforme", platformForm(villa, 320, 322, { externalRef: ref }))).state).toMatchObject({
      error: `La référence Airbnb ${ref} est déjà enregistrée : ouvrez cette réservation plutôt que de la saisir à nouveau.`,
    });
    // The same code on another platform is another booking.
    expect((await create("plateforme", platformForm(villa, 320, 322, { externalRef: ref, source: "AGODA" }))).id).toBeTruthy();
    // Another organization has its own codes.
    as(otherAdmin);
    expect((await create("plateforme", platformForm(otherListing, 320, 322, { externalRef: ref }))).id).toBeTruthy();
  });
});

describe("owner blocks and overlaps", () => {
  it("an owner block is dates and a reason, nothing else", async () => {
    const id = await created("blocage", blockForm(home, 330, 340, { guestName: "Intrus", total: "999", adults: "3" }));
    expect(await db.booking.findUniqueOrThrow({ where: { id } })).toMatchObject({
      source: "OWNER",
      note: "Séjour du propriétaire",
      guestName: null,
      guestPhone: null,
      externalRef: null,
      totalCents: null,
      adults: 0,
      channel: null,
    });
    expect((await db.auditLog.findFirstOrThrow({ where: { targetId: id } })).action).toBe("owner_block.created");
    expect((await create("blocage", blockForm(home, 341, 343, { note: "" }))).state?.fieldErrors).toEqual({ note: "Motif : champ obligatoire" });
  });

  it("a booking over an owner block is refused, and the reverse, with what is in the way", async () => {
    await created("blocage", blockForm(villa, 350, 357));
    expect((await create("directe", directForm(villa, 355, 358))).state).toMatchObject({
      error: `Ces dates chevauchent un blocage propriétaire du ${fmt(350)} au ${fmt(357)}. Choisissez d'autres dates ou modifiez d'abord cette réservation.`,
    });
    const ref = `HMOVER${TOKEN.slice(-5)}`;
    expect((await create("plateforme", platformForm(villa, 349, 351, { externalRef: ref }))).state?.error).toContain("un blocage propriétaire");

    await created("plateforme", platformForm(villa, 360, 364, { externalRef: ref }));
    expect((await create("blocage", blockForm(villa, 362, 370))).state).toMatchObject({
      error: expect.stringContaining(`une réservation Airbnb (${ref}) du ${fmt(360)} au ${fmt(364)}`),
    });
    await created("directe", directForm(villa, 370, 372));
    expect((await create("blocage", blockForm(villa, 371, 375))).state?.error).toContain(`une réservation directe du ${fmt(370)} au ${fmt(372)}`);
    // Back to back is fine: the departure day is the next arrival day.
    expect((await create("blocage", blockForm(villa, 357, 360))).id).toBeTruthy();
    expect((await create("directe", directForm(villa, 364, 370))).id).toBeTruthy();
  });

  it("concurrent entries on the same dates: exactly one wins (database exclusion constraint)", async () => {
    const results = await Promise.all([0, 1, 2].map(() => create("directe", directForm(villa, 380, 383))));
    expect(results.filter((r) => r.id)).toHaveLength(1);
    for (const r of results.filter((x) => !x.id)) expect(r.state?.error).toMatch(/chevauchent|viennent d'être prises/);
    expect(await db.booking.count({ where: { listingId: villa, status: "CONFIRMED", checkIn: at(380) } })).toBe(1);
  });
});

const fmt = (n: number) => {
  const [y, m, d] = day(n).split("-");
  return `${d}/${m}/${y}`;
};

describe("changing dates and cancelling", () => {
  it("re-prices a direct booking for its new nights, can overlap its own old dates, never another booking", async () => {
    const id = await created("directe", directForm(villa, 400, 402, { nightly: "1 000", cleaning: "100" }));
    expect(await rescheduleBookingAction(id, {}, form({ checkIn: day(401), checkOut: day(404) }))).toEqual({ message: "Dates modifiées." });
    expect(await db.booking.findUniqueOrThrow({ where: { id } })).toMatchObject({ checkIn: at(401), checkOut: at(404), nightlyCents: 100_000, cleaningFeeCents: 10_000, totalCents: 310_000 });
    const log = await db.auditLog.findFirstOrThrow({ where: { targetId: id, action: "booking.dates_changed" } });
    expect(log.details).toMatchObject({ from: { checkIn: day(400), checkOut: day(402) }, to: { checkIn: day(401), checkOut: day(404) }, totalCents: { from: 210_000, to: 310_000 } });

    await created("blocage", blockForm(villa, 404, 410));
    expect((await rescheduleBookingAction(id, {}, form({ checkIn: day(402), checkOut: day(406) }))).error).toContain("un blocage propriétaire");
    expect((await rescheduleBookingAction(id, {}, form({ checkIn: day(406), checkOut: day(402) }))).fieldErrors).toEqual({ checkOut: "Départ : après l'arrivée" });
    expect(await db.booking.findUniqueOrThrow({ where: { id } })).toMatchObject({ checkIn: at(401), checkOut: at(404) });
  });

  it("keeps the minimum stay on new dates of a direct booking, and a platform total as it is", async () => {
    const id = await created("directe", directForm(home, 420, 424));
    expect((await rescheduleBookingAction(id, {}, form({ checkIn: day(420), checkOut: day(421) }))).error).toContain("3 nuits minimum");
    expect(await rescheduleBookingAction(id, {}, form({ checkIn: day(420), checkOut: day(421), allowShortStay: "on" }))).toEqual({ message: "Dates modifiées." });
    expect((await db.booking.findUniqueOrThrow({ where: { id } })).totalCents).toBe(120_000);

    const p = await created("plateforme", platformForm(home, 430, 433, { total: "5 000" }));
    expect(await rescheduleBookingAction(p, {}, form({ checkIn: day(430), checkOut: day(431) }))).toEqual({ message: "Dates modifiées." });
    expect(await db.booking.findUniqueOrThrow({ where: { id: p } })).toMatchObject({ checkOut: at(431), totalCents: 500_000 });
  });

  it("cancelling needs a confirmation, frees the dates, is audited, and happens once", async () => {
    const id = await created("blocage", blockForm(home, 440, 445));
    expect(await cancelBookingAction(id, {}, form({}))).toEqual({ error: "Cochez la case pour confirmer." });
    expect(await cancelBookingAction(id, {}, form({ confirm: "on" }))).toEqual({ message: "Blocage levé : les dates sont de nouveau libres." });
    expect(await db.booking.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "CANCELLED", cancelledAt: expect.any(Date) });
    expect((await db.auditLog.findFirstOrThrow({ where: { targetId: id, action: "owner_block.cancelled" } })).actorId).toBe(adminId);
    expect(await cancelBookingAction(id, {}, form({ confirm: "on" }))).toEqual({ error: "Cette réservation est déjà annulée." });
    expect((await rescheduleBookingAction(id, {}, form({ checkIn: day(440), checkOut: day(446) }))).error).toContain("annulée");
    // The dates are free again.
    expect((await create("directe", directForm(home, 440, 445))).id).toBeTruthy();

    const air = await created("plateforme", platformForm(home, 450, 453));
    expect(await cancelBookingAction(air, {}, form({ confirm: "on" }))).toEqual({ message: "Réservation annulée dans Sigma. Annulez-la aussi sur la plateforme." });
  });

  it("a stay that is over can no longer be cancelled", async () => {
    const id = await created("directe", directForm(villa, 460, 463));
    const access = { user: { id: adminId, name: "A", email: "a", role: "ADMIN" as const, twoFactorEnabled: true }, organizationId: sigma };
    await expect(cancelStaffBooking(access, id, at(463))).rejects.toMatchObject({ status: 409, message: "Ce séjour est terminé : il ne s'annule plus." });
  });
});

describe("organizations stay apart", () => {
  it("another organization's listing or booking is not found, and nothing changes", async () => {
    as(otherAdmin);
    const theirs = await created("blocage", blockForm(otherListing, 470, 475));
    as(admin);
    expect((await create("directe", directForm(otherListing, 480, 483))).state).toMatchObject({ error: "Bien introuvable." });
    expect((await create("blocage", blockForm(otherListing, 480, 483))).state).toMatchObject({ error: "Bien introuvable." });
    expect(await rescheduleBookingAction(theirs, {}, form({ checkIn: day(476), checkOut: day(478) }))).toEqual({ error: "Réservation introuvable." });
    expect(await cancelBookingAction(theirs, {}, form({ confirm: "on" }))).toEqual({ error: "Réservation introuvable." });
    expect(await getStaffBooking(sigma, theirs, true)).toBeNull();
    expect(await db.booking.findUniqueOrThrow({ where: { id: theirs } })).toMatchObject({ status: "CONFIRMED", checkIn: at(470) });
    expect(await db.booking.count({ where: { listingId: otherListing, organizationId: sigma } })).toBe(0);
    // Ids that can't exist answer the same.
    expect(await cancelBookingAction("../x", {}, form({ confirm: "on" }))).toEqual({ error: "Réservation introuvable." });
    expect((await create("directe", directForm("inconnu", 480, 483))).state).toMatchObject({ error: "Bien introuvable." });

    const cal = await calendarData(sigma, at(460), at(490), {}, true);
    expect(cal.listings.map((l) => l.id)).not.toContain(otherListing);
    expect(cal.entries.map((e) => e.id)).not.toContain(theirs);
    expect((await listStaffBookings(sigma, { from: at(460), to: at(490) }, true)).items.map((e) => e.id)).not.toContain(theirs);
  });
});

describe("what the team reads", () => {
  it("the calendar: every source over the window, cancelled hidden, amounts for associés only", async () => {
    const d = await created("directe", directForm(home, 500, 503));
    const p = await created("plateforme", platformForm(home, 504, 506, { guestName: "Kim Min-jun", guestPhone: "+82 10 1234 5678" }));
    const o = await created("blocage", blockForm(home, 510, 520));
    const c = await created("directe", directForm(home, 521, 525));
    await cancelBookingAction(c, {}, form({ confirm: "on" }));

    const forAdmin = await calendarData(sigma, at(498), at(512), { q: TOKEN }, true);
    expect(forAdmin.listings.map((l) => l.id).sort()).toEqual([home, villa].sort());
    expect(forAdmin.entries.map((e) => e.id)).toEqual([d, p, o]);
    expect(forAdmin.entries[0]).toMatchObject({ source: "DIRECT", checkIn: day(500), checkOut: day(503), nights: 3, guestName: "Yassine El Amrani", amounts: { totalCents: 320_000 } });
    expect(forAdmin.entries[1]).toMatchObject({ source: "AIRBNB", guestName: "Kim Min-jun", guestPhone: "+82 10 1234 5678", amounts: null });
    expect(forAdmin.entries[2]).toMatchObject({ source: "OWNER", guestName: null, note: "Séjour du propriétaire" });

    const forAgent = await calendarData(sigma, at(498), at(512), { q: TOKEN }, false);
    expect(forAgent.entries.map((e) => e.id)).toEqual([d, p, o]);
    for (const e of forAgent.entries) expect("amounts" in e).toBe(false);
    expect(JSON.stringify(forAgent)).not.toMatch(/Cents/);
    // Agents still have the guest's name and phone to welcome them.
    expect(forAgent.entries[1]).toMatchObject({ guestName: "Kim Min-jun", guestPhone: "+82 10 1234 5678" });
    expect(JSON.stringify(await getStaffBooking(sigma, d, false))).not.toMatch(/Cents/);
    expect(JSON.stringify((await listStaffBookings(sigma, { listingId: home }, false)).items)).not.toMatch(/Cents/);
  });

  it("the list filters by source, listing, dates and status", async () => {
    const list = (f: Parameters<typeof listStaffBookings>[1]) => listStaffBookings(sigma, { listingId: home, from: at(498), to: at(530), ...f }, true);
    expect((await list({ source: "OWNER" })).items.map((e) => e.source)).toEqual(["OWNER"]);
    expect((await list({})).items.every((e) => e.status === "CONFIRMED")).toBe(true);
    expect((await list({ status: "CANCELLED" })).items).toHaveLength(1);
    expect((await list({ status: "ALL" })).total).toBe(4);
    expect((await list({ from: at(505), to: at(511) })).items.map((e) => e.source)).toEqual(["AIRBNB", "OWNER"]);
    expect((await list({ listingId: villa, from: at(498), to: at(530) })).total).toBe(0);
  });

  it("the public site only learns that the dates are taken", async () => {
    const ranges = await bookedRanges(sigma, home, at(495), at(530));
    expect(ranges).toEqual(expect.arrayContaining([{ checkIn: day(500), checkOut: day(503) }, { checkIn: day(510), checkOut: day(520) }]));
    for (const r of ranges) expect(Object.keys(r).sort()).toEqual(["checkIn", "checkOut"]);
  });
});
