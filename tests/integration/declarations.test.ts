import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/generated/prisma/enums";

/**
 * Travellers' declaration and taxe de séjour (Lot 5) through the real server actions, routes and functions: who may
 * record, see, export and declare the fiches (associés; an agent only from their welcome task of today or tomorrow;
 * nobody else; never across organizations), what the database and the file store hold (ciphertext only), the audit
 * trail (every view, export and change, never a value), the exports, the undeclared arrivals, the automatic purge
 * after the retention delay (dry run, then only what is past the delay), and the tax snapshot with versioned rates.
 * Every row is on homes and organizations this file creates, deleted at the end; bookings from day 200 on, or around
 * today on this file's own homes (check-in tasks).
 */
const ctx = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({
  headers: async () => ctx.headers,
  cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/cache")>()), updateTag: vi.fn(), refresh: vi.fn() }));

const act = await import("@/app/admin/declarations/actions");
const settings = await import("@/app/admin/parametres/actions");
const { GET: exportRoute } = await import("@/app/api/admin/declarations/export/route");
const { GET: documentRoute } = await import("@/app/api/admin/declarations/documents/[id]/route");
const { GET: taxRoute } = await import("@/app/api/admin/declarations/taxe/route");
const { GET: media } = await import("@/app/media/[...key]/route");
const { cancelStaffBooking, createStaffEntry, rescheduleStaffBooking } = await import("@/lib/server/admin/bookings");
const { parseEntryForm } = await import("@/lib/admin/booking-form");
const { travelersForCapture, saveTraveler, searchDeclarations, setDeclared, undeclaredArrivals, travelerSummary, capturesToday } = await import("@/lib/server/declarations/travelers");
const { purgeIdentities } = await import("@/lib/server/declarations/purge");
const { addOrgTaxRate, addListingTaxRate, getBookingTax, monthlyTaxReport } = await import("@/lib/server/declarations/tax");
const { monthTotals } = await import("@/lib/tax/engine");
const { ENVELOPE_RE } = await import("@/lib/secrets/envelope");
const { addDays, isoDay } = await import("@/lib/admin/calendar");
const { db } = await import("@/lib/server/db");
const { LocalStorage } = await import("@/lib/storage/local");
const { setFileStorage } = await import("@/lib/storage");
const { day, sigmaOrgId } = await import("./helpers");
const { signedInMember } = await import("./staff");

type Authorized = import("@/lib/server/authz").Authorized;

const sigma = await sigmaOrgId();
const TOKEN = `D${Date.now()}`;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const LAST = `TESTNOM${TOKEN.slice(-6)}`;
const DOC = `TEST${TOKEN.slice(-6)}`;

interface Member {
  headers: Headers;
  actor: Authorized;
  id: string;
}

let storeDir: string;
let admin: Member;
let agent: Member;
let agent2: Member;
let otherAdmin: Member;
let otherOrg: string;
let taxOrg: string;
let purgeOrg: string;
let home: string;
let otherHome: string;
const refused = new Map<string, Headers>();
const createdUsers: string[] = [];
const ownListings: string[] = [];
const orgs: string[] = [];

const as = (h: Headers) => {
  ctx.headers = h;
};
function form(values: Record<string, string>, file?: Buffer) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.append(k, v);
  if (file) f.set("document", new File([new Uint8Array(file)], "piece.png", { type: "image/png" }));
  return f;
}
const adultValues = (firstName: string, extra: Record<string, string> = {}) => ({
  lastName: LAST,
  firstName,
  sex: "F",
  birthDate: "1990-04-05",
  nationality: "FR",
  documentType: "PASSPORT",
  documentNumber: `${DOC}${firstName.slice(0, 1).toUpperCase()}`,
  residenceCountry: "FR",
  ...extra,
});

async function member(role: Role, organizationId: string | null, twoFactor = true): Promise<Member> {
  const m = await signedInMember({ role, organizationId, twoFactor, name: `${role} ${TOKEN}` });
  createdUsers.push(m.user.id);
  const actor: Authorized = { user: { id: m.user.id, name: m.user.name, email: m.user.email, role, twoFactorEnabled: twoFactor }, organizationId: organizationId ?? "" };
  return { headers: m.headers, actor, id: m.user.id };
}
const actorOf = (organizationId: string, role: Role = "ADMIN"): Authorized => ({ user: { id: `sys_${TOKEN}`, name: "Test", email: "t@test.sigma.test", role, twoFactorEnabled: true }, organizationId });

async function makeOrg(prefix: string) {
  const id = (await db.organization.create({ data: { name: `${prefix} ${TOKEN}`, slug: `${prefix}-${TOKEN.toLowerCase()}` } })).id;
  orgs.push(id);
  return id;
}

async function makeHome(organizationId: string, title: string) {
  const owner = await db.user.create({ data: { name: `Owner ${TOKEN}`, email: `owner-${title.replace(/\W/g, "").toLowerCase()}-${TOKEN.toLowerCase()}@test.sigma.test`, role: "OWNER", organizationId } });
  createdUsers.push(owner.id);
  const place = await db.place.findFirstOrThrow({ where: { slug: "medina" } });
  const l = await db.listing.create({
    data: { title: `${title} ${TOKEN}`, description: "x", organizationId, placeId: place.id, ownerId: owner.id, address: `Derb ${TOKEN}`, licenseNumber: `80-14/${TOKEN}`, lat: 31.63, lng: -7.99, maxGuests: 6, minNights: 1, priceCents: 90_000 },
  });
  ownListings.push(l.id);
  return l.id;
}

/** A direct stay typed by an associé of `actor`'s organization, dates as yyyy-MM-dd. */
async function stay(actor: Authorized, listingId: string, checkIn: string, checkOut: string, adults = 2, children = 0) {
  const entry = parseEntryForm("directe", { listingId, checkIn, checkOut, adults: String(adults), children: String(children), note: "", guestName: `Client ${TOKEN}`, guestPhone: "+212600000000", channel: "PHONE", nightly: "", cleaning: "" });
  if (!entry.ok) throw new Error(JSON.stringify(entry.fieldErrors));
  return (await createStaffEntry(actor, entry.entry)).id;
}

/** Marrakech's today + n, yyyy-MM-dd: the agent's window is in Marrakech days. */
const md = (n: number) => isoDay(addDays(capturesToday(), n));

async function checkinTask(bookingId: string, assigneeId: string | null) {
  const t = await db.task.findFirstOrThrow({ where: { bookingId, type: "CHECKIN" } });
  return db.task.update({ where: { id: t.id }, data: { assigneeId } });
}

const exportGet = (headers: Headers, qs: string) => exportRoute(new Request(`http://localhost:3100/api/admin/declarations/export?${qs}`, { headers }));
const documentGet = (headers: Headers, id: string) => documentRoute(new Request(`http://localhost:3100/api/admin/declarations/documents/${id}`, { headers }), { params: Promise.resolve({ id }) });

beforeAll(async () => {
  storeDir = await mkdtemp(join(tmpdir(), "sigma-identity-"));
  setFileStorage(new LocalStorage(storeDir));
  admin = await member("ADMIN", sigma);
  agent = await member("AGENT", sigma);
  agent2 = await member("AGENT", sigma);
  home = await makeHome(sigma, "Riad declarations");
  otherOrg = await makeOrg("decl-other");
  otherHome = await makeHome(otherOrg, "Autre riad");
  otherAdmin = await member("ADMIN", otherOrg);
  taxOrg = await makeOrg("decl-tax");
  purgeOrg = await makeOrg("decl-purge");
  refused.set("anonymous", new Headers());
  refused.set("guest", (await member("GUEST", null, false)).headers);
  refused.set("owner", (await member("OWNER", sigma, false)).headers);
  refused.set("admin without 2FA", (await member("ADMIN", sigma, false)).headers);
});

beforeEach(() => as(admin.headers));

afterAll(async () => {
  const bookingIds = (await db.booking.findMany({ where: { listingId: { in: ownListings } }, select: { id: true } })).map((b) => b.id);
  // This file's entries: on its homes, stays and accounts, by its accounts (Sigma's organization-level ones too), and
  // everything of the organizations it created.
  await db.auditLog.deleteMany({
    where: { OR: [{ targetId: { in: [...ownListings, ...bookingIds, ...createdUsers] } }, { actorId: { in: createdUsers } }, { organizationId: { in: orgs } }] },
  });
  await db.identityPurge.deleteMany({ where: { OR: [{ organizationId: { in: orgs } }, { bookingId: { in: bookingIds } }] } });
  // Travellers, documents, tax snapshots and tasks go with the bookings; listing rates with the listings.
  await db.booking.deleteMany({ where: { listingId: { in: ownListings } } });
  await db.listing.deleteMany({ where: { id: { in: ownListings } } });
  await db.touristTaxRate.deleteMany({ where: { organizationId: { in: orgs } } });
  await db.checklistTemplate.deleteMany({ where: { organizationId: { in: orgs } } });
  await db.user.deleteMany({ where: { OR: [{ organizationId: { in: orgs } }, { id: { in: createdUsers } }] } });
  await db.organization.deleteMany({ where: { id: { in: orgs } } });
  setFileStorage(undefined);
  await rm(storeDir, { recursive: true, force: true });
});

describe("who may record and see the fiches", () => {
  it("refuses anonymous visitors, guests, owners and an associé without double authentification, everywhere", async () => {
    const booking = await stay(admin.actor, home, day(200), day(202));
    const task = await checkinTask(booking, null);
    for (const [who, headers] of refused) {
      as(headers);
      const results = [
        await act.saveTravelerAction({ bookingId: booking }, null, {}, form(adultValues("Pirate"))),
        await act.saveTravelerAction({ taskId: task.id }, null, {}, form(adultValues("Pirate"))),
        await act.setDeclaredAction(booking, true),
        await act.computeTaxAction(booking),
        await act.setTaxClosedAction(booking, true),
        await settings.saveRetentionAction({}, form({ retentionDays: "1" })),
        await settings.addOrgRateAction({}, form({ effectiveFrom: md(1), rate: "1" })),
      ];
      for (const r of results) expect(r.error, who).toMatch(/Connectez-vous|Accès refusé|double authentification/);
      const res = await exportGet(headers, `format=csv&du=${day(199)}&au=${day(201)}`);
      expect([401, 403], who).toContain(res.status);
      expect(await res.text()).not.toContain(LAST);
      expect([401, 403], who).toContain((await taxRoute(new Request("http://localhost:3100/api/admin/declarations/taxe?mois=2027-01", { headers }))).status);
    }
    expect(await db.traveler.count({ where: { bookingId: booking } })).toBe(0);
    expect((await db.organization.findUniqueOrThrow({ where: { id: sigma } })).identityRetentionDays).not.toBe(1);
  });

  it("an agent records the fiches of their own check-in of today, with a document photo, and nothing else", async () => {
    const booking = await stay(admin.actor, home, md(0), md(2));
    const task = await checkinTask(booking, agent.id);
    as(agent.headers);
    // Not through Déclarations (associés only)…
    expect(await act.saveTravelerAction({ bookingId: booking }, null, {}, form(adultValues("Agent")))).toEqual({ error: "Accès refusé." });
    expect(await act.setDeclaredAction(booking, true)).toEqual({ error: "Accès refusé." });
    // …but from the task.
    const r = await act.saveTravelerAction({ taskId: task.id }, null, {}, form(adultValues("Amina"), PNG));
    expect(r).toMatchObject({ message: "Voyageur enregistré." });
    const second = await act.saveTravelerAction({ taskId: task.id }, null, {}, form(adultValues("Basma", { sex: "F", nationality: "MA", documentType: "CIN" })));
    expect(second).toMatchObject({ message: "Voyageur enregistré." });
    const view = await travelersForCapture(agent.actor, { taskId: task.id });
    expect(view.travelers.map((t) => t.identity.firstName)).toEqual(["Amina", "Basma"]);
    expect(view.travelers[0].documents).toHaveLength(1);
    // The agent never gets a document, not even the one they took.
    expect((await documentGet(agent.headers, view.travelers[0].documents[0].id)).status).toBe(403);
    // Corrects a fiche while the task is on.
    const fix = await act.saveTravelerAction({ taskId: task.id }, view.travelers[1].id, {}, form(adultValues("Basma", { birthPlace: "Fès", nationality: "MA", documentType: "CIN" })));
    expect(fix).toMatchObject({ message: "Fiche modifiée." });
    // Audited, with ids and counts only.
    const logs = await db.auditLog.findMany({ where: { targetId: booking } });
    expect(logs.filter((l) => l.action === "traveler.added")).toHaveLength(2);
    expect(logs.find((l) => l.action === "traveler.added")?.details).toMatchObject({ via: "task", taskId: task.id });
    expect(logs.some((l) => l.action === "travelers.viewed" && l.actorId === agent.id)).toBe(true);
    expect(logs.some((l) => l.action === "traveler.document_added")).toBe(true);
    const text = JSON.stringify(logs);
    for (const v of [LAST, "Amina", DOC, "1990-04-05", "Fès"]) expect(text).not.toContain(v);

    // Once the task is done, the agent sees nothing any more.
    await db.task.update({ where: { id: task.id }, data: { status: "DONE", startedAt: new Date(), completedAt: new Date() } });
    await expect(travelersForCapture(agent.actor, { taskId: task.id })).rejects.toMatchObject({ status: 404 });
    expect((await act.saveTravelerAction({ taskId: task.id }, null, {}, form(adultValues("Late")))).error).toMatch(/indisponibles/);
    // The associé still sees them.
    expect((await travelersForCapture(admin.actor, { bookingId: booking })).travelers).toHaveLength(2);
  });

  it("refuses a colleague's check-in, a check-in in three days, another task type, and another organization's", async () => {
    const soon = await stay(admin.actor, home, md(3), md(4));
    const soonTask = await checkinTask(soon, agent.id);
    const now = await stay(admin.actor, home, md(5), md(6));
    void now;
    const today = await stay(admin.actor, home, md(7), md(8));
    const colleagueTask = await checkinTask(today, agent2.id);
    as(agent.headers);
    for (const t of [soonTask.id, colleagueTask.id]) expect((await act.saveTravelerAction({ taskId: t }, null, {}, form(adultValues("Nope")))).error).toMatch(/indisponibles/);
    const cleaning = await db.task.findFirstOrThrow({ where: { bookingId: soon, type: "CLEANING" } });
    await db.task.update({ where: { id: cleaning.id }, data: { assigneeId: agent.id } });
    expect((await act.saveTravelerAction({ taskId: cleaning.id }, null, {}, form(adultValues("Nope")))).error).toMatch(/indisponibles/);
    as(otherAdmin.headers);
    expect((await act.saveTravelerAction({ taskId: soonTask.id }, null, {}, form(adultValues("Nope")))).error).toMatch(/indisponibles/);
    expect(await db.traveler.count({ where: { bookingId: { in: [soon, today] } } })).toBe(0);
  });

  it("another organization's associé finds neither the stay, nor its fiches, nor its documents", async () => {
    const booking = await stay(admin.actor, home, day(204), day(206));
    expect(await act.saveTravelerAction({ bookingId: booking }, null, {}, form(adultValues("Cross"), PNG))).toMatchObject({ message: "Voyageur enregistré." });
    const doc = await db.travelerDocument.findFirstOrThrow({ where: { traveler: { bookingId: booking } } });
    const traveler = await db.traveler.findFirstOrThrow({ where: { bookingId: booking } });
    as(otherAdmin.headers);
    expect(await act.saveTravelerAction({ bookingId: booking }, null, {}, form(adultValues("X")))).toMatchObject({ error: "Réservation introuvable." });
    expect(await act.saveTravelerAction({ bookingId: booking }, traveler.id, {}, form(adultValues("X")))).toMatchObject({ error: "Réservation introuvable." });
    expect(await act.deleteTravelerAction({ bookingId: booking }, traveler.id)).toEqual({ error: "Réservation introuvable." });
    expect(await act.setDeclaredAction(booking, true)).toEqual({ error: "Réservation introuvable." });
    expect(await act.computeTaxAction(booking)).toEqual({ error: "Réservation introuvable." });
    expect(await act.deleteTravelerDocumentAction({ bookingId: booking }, doc.id)).toEqual({ error: "Réservation introuvable." });
    expect((await documentGet(otherAdmin.headers, doc.id)).status).toBe(404);
    const csv = await (await exportGet(otherAdmin.headers, `format=csv&du=${day(203)}&au=${day(207)}`)).text();
    expect(csv).not.toContain("Cross");
    // A traveller id of the right organization but another stay is not found either.
    const mine = await stay(otherAdmin.actor, otherHome, day(204), day(206));
    expect(await act.saveTravelerAction({ bookingId: mine }, traveler.id, {}, form(adultValues("X")))).toMatchObject({ error: "Fiche voyageur introuvable." });
    expect(await db.traveler.count({ where: { id: traveler.id, declaredAt: null } })).toBe(1);
  });

  it("owner blocks have no travellers; cancelled stays can't get new fiches", async () => {
    const entry = parseEntryForm("blocage", { listingId: home, checkIn: day(208), checkOut: day(210), note: "Propriétaire" });
    if (!entry.ok) throw new Error("bad block");
    const block = (await createStaffEntry(admin.actor, entry.entry)).id;
    expect(await act.saveTravelerAction({ bookingId: block }, null, {}, form(adultValues("Block")))).toMatchObject({ error: "Réservation introuvable." });
    await expect(db.traveler.create({ data: { organizationId: sigma, bookingId: block, identityEnc: "v1.00000000.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AA" } })).rejects.toThrow(/travelers_booking_check/);
    const cancelled = await stay(admin.actor, home, day(210), day(211));
    await cancelStaffBooking(admin.actor, cancelled);
    expect(await act.saveTravelerAction({ bookingId: cancelled }, null, {}, form(adultValues("Annule")))).toMatchObject({ error: "Ce séjour est annulé : ses fiches voyageurs ne se modifient plus." });
  });
});

describe("what is stored", () => {
  it("holds only ciphertext in the database and on disk; the scan is served decrypted to the associés only, audited, never cached", async () => {
    const booking = await stay(admin.actor, home, day(212), day(214));
    expect(await act.saveTravelerAction({ bookingId: booking }, null, {}, form(adultValues("Chiffre", { address: `Adresse ${TOKEN}` }), PNG))).toMatchObject({ message: "Voyageur enregistré." });
    const rows = await db.$queryRaw<{ row: string; identityEnc: string }[]>`SELECT row_to_json(t)::text AS "row", "identityEnc" FROM "travelers" t WHERE "bookingId" = ${booking}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].identityEnc).toMatch(ENVELOPE_RE);
    for (const v of [LAST, "Chiffre", DOC, "1990-04-05", `Adresse ${TOKEN}`, "PASSPORT"]) expect(rows[0].row).not.toContain(v);
    // The database refuses anything else.
    await expect(db.traveler.create({ data: { organizationId: sigma, bookingId: booking, identityEnc: JSON.stringify({ lastName: LAST }) } })).rejects.toThrow(/travelers_identity_check/);

    const doc = await db.travelerDocument.findFirstOrThrow({ where: { traveler: { bookingId: booking } } });
    expect(doc.storageKey).toMatch(new RegExp(`^identity/${sigma}/${booking}/[0-9a-f]{32}\\.enc$`));
    expect(doc).toMatchObject({ contentType: "image/png", byteSize: PNG.byteLength });
    const onDisk = await readFile(join(storeDir, doc.storageKey));
    expect(onDisk.subarray(0, 4).toString("ascii")).toBe("SGE1");
    expect(onDisk.includes(PNG.subarray(0, 8))).toBe(false);
    expect(onDisk.includes(PNG.subarray(16, 40))).toBe(false);
    await expect(db.travelerDocument.create({ data: { organizationId: sigma, travelerId: doc.travelerId, storageKey: "identity/clear.png", contentType: "image/png", byteSize: 10 } })).rejects.toThrow(/traveler_documents_check/);
    // Not through /media.
    expect((await media(new Request(`http://localhost:3100/media/${doc.storageKey}`, { headers: admin.headers }), { params: Promise.resolve({ key: doc.storageKey.split("/") }) })).status).toBe(404);

    const res = await documentGet(admin.headers, doc.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
    expect(await db.auditLog.count({ where: { targetId: booking, action: "traveler.document_viewed", actorId: admin.id } })).toBe(1);
    expect((await documentGet(admin.headers, "nope")).status).toBe(404);
    expect((await documentGet(agent.headers, doc.id)).status).toBe(403);

    // Deleting the photo deletes the file.
    expect(await act.deleteTravelerDocumentAction({ bookingId: booking }, doc.id)).toEqual({ message: "Photo supprimée." });
    await expect(readFile(join(storeDir, doc.storageKey))).rejects.toThrow();
    // Not an image or a PDF: refused.
    const t = await db.traveler.findFirstOrThrow({ where: { bookingId: booking } });
    const bad = new FormData();
    bad.set("document", new File([new TextEncoder().encode("not an image")], "x.png", { type: "image/png" }));
    expect((await act.uploadTravelerDocumentAction({ bookingId: booking }, t.id, bad)).error).toMatch(/Format non accepté/);
  });

  it("an associé's every reading of the fiches is audited, with the count", async () => {
    const booking = await stay(admin.actor, home, day(216), day(218));
    await saveTraveler(admin.actor, { bookingId: booking }, null, adultValues("Lecture"));
    const before = await db.auditLog.count({ where: { targetId: booking, action: "travelers.viewed" } });
    const v = await travelersForCapture(admin.actor, { bookingId: booking });
    expect(v.travelers[0].identity).toMatchObject({ firstName: "Lecture", lastName: LAST });
    expect(await db.auditLog.count({ where: { targetId: booking, action: "travelers.viewed" } })).toBe(before + 1);
    const found = await searchDeclarations(admin.actor, { from: new Date(`${day(216)}T00:00:00Z`), to: new Date(`${day(216)}T00:00:00Z`), q: "lecture" });
    expect(found.map((s) => s.bookingId)).toEqual([booking]);
    const listLog = await db.auditLog.findFirstOrThrow({ where: { organizationId: sigma, action: "travelers.viewed", targetType: "organization", actorId: admin.id }, orderBy: { createdAt: "desc" } });
    expect(listLog.details).toMatchObject({ via: "list", count: 1, search: true });
    expect(JSON.stringify(listLog.details)).not.toContain("lecture");
  });

  it("validates the fiche and links a minor to an adult of the stay", async () => {
    const booking = await stay(admin.actor, home, day(220), day(223), 1, 1);
    const bad = await act.saveTravelerAction({ bookingId: booking }, null, {}, form({ lastName: "", nationality: "XX" }));
    expect(bad).toMatchObject({ error: "Corrigez les champs signalés.", fieldErrors: { lastName: "Obligatoire.", nationality: "Pays inconnu." } });
    const adult = await saveTraveler(admin.actor, { bookingId: booking }, null, adultValues("Parent"));
    if (!adult.ok) throw new Error("adult refused");
    const minor = { lastName: LAST, firstName: "Enfant", sex: "M", birthDate: "2018-06-01", nationality: "FR" };
    expect(await saveTraveler(admin.actor, { bookingId: booking }, null, minor)).toMatchObject({ ok: false, fieldErrors: { guardianId: expect.any(String) } });
    const child = await saveTraveler(admin.actor, { bookingId: booking }, null, { ...minor, guardianId: adult.id });
    expect(child).toMatchObject({ ok: true });
    const rows = await db.traveler.findMany({ where: { bookingId: booking }, orderBy: { isMinor: "asc" } });
    expect(rows.map((r) => [r.isMinor, r.guardianId])).toEqual([
      [false, null],
      [true, adult.id],
    ]);
    // The adult can't be deleted while a minor depends on them; a minor can't be someone's guardian.
    expect(await act.deleteTravelerAction({ bookingId: booking }, adult.id)).toEqual({ error: "Ce voyageur accompagne des mineurs : supprimez d'abord leurs fiches." });
    expect(await saveTraveler(admin.actor, { bookingId: booking }, null, { ...minor, firstName: "Autre", guardianId: rows[1].id })).toMatchObject({ ok: false, fieldErrors: { guardianId: expect.any(String) } });
    // The database holds the same rule.
    await expect(db.traveler.update({ where: { id: rows[0].id }, data: { guardianId: rows[1].id, isMinor: true } })).rejects.toThrow(/travelers_guardian_check/);
    expect(await travelerSummary(sigma, booking)).toMatchObject({ travelers: 2, adults: 1, minors: 1, declared: 0, complete: false });
  });
});

describe("export and declaration", () => {
  it("exports the period's travellers as CSV and printable fiches (audited, nothing stored), then marks them declared", async () => {
    const booking = await stay(admin.actor, home, day(230), day(233));
    const outside = await stay(admin.actor, home, day(236), day(237));
    await saveTraveler(admin.actor, { bookingId: booking }, null, adultValues("Export", { birthPlace: "Ville; fictive", comingFrom: "Paris" }));
    await saveTraveler(admin.actor, { bookingId: outside }, null, adultValues("Dehors"));
    const qs = `du=${day(229)}&au=${day(231)}&bien=${home}`;
    const res = await exportGet(admin.headers, `format=csv&${qs}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="declaration-voyageurs_.*\.csv"$/);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = bytes.toString("utf8").slice(1);
    const lines = csv.split("\r\n");
    expect(lines[0]).toMatch(/^N°;Nom;Prénom;Sexe;Date de naissance;/);
    expect(lines).toHaveLength(3);
    const [y, m, d] = day(230).split("-");
    expect(lines[1]).toContain(`;${LAST};Export;Féminin;05/04/1990;"Ville; fictive";France;Passeport;`);
    expect(lines[1]).toContain(`;${d}/${m}/${y};`);
    expect(csv).not.toContain("Dehors");
    const log = await db.auditLog.findFirstOrThrow({ where: { organizationId: sigma, action: "declaration.exported", actorId: admin.id }, orderBy: { createdAt: "desc" } });
    expect(log.details).toMatchObject({ format: "csv", count: 1, stays: 1, listingId: home });
    expect(JSON.stringify(log.details)).not.toContain(LAST);

    const html = await (await exportGet(admin.headers, `format=fiches&${qs}`)).text();
    expect(html).toContain("Fiche individuelle n° 1");
    expect(html).toContain("Format à valider avec la DGSN");
    expect(html).toContain(LAST);
    expect((await exportGet(admin.headers, `format=xml&${qs}`)).status).toBe(400);
    expect((await exportGet(admin.headers, `format=csv&du=${day(200)}&au=${day(700)}`)).status).toBe(422);

    // Undeclared only, then declared.
    expect(await (await exportGet(admin.headers, `format=csv&${qs}&nondeclares=1`)).text()).toContain("Export");
    expect(await act.setDeclaredAction(booking, true)).toEqual({ message: "Déclaration enregistrée (1 voyageur)." });
    const t = await db.traveler.findFirstOrThrow({ where: { bookingId: booking } });
    expect(t.declaredAt).not.toBeNull();
    expect(t.declaredById).toBe(admin.id);
    expect(await (await exportGet(admin.headers, `format=csv&${qs}&nondeclares=1`)).text()).not.toContain("Export");
    expect(await db.auditLog.count({ where: { targetId: booking, action: "travelers.declared" } })).toBe(1);
    expect(await act.setDeclaredAction(booking, false)).toEqual({ message: "Déclaration annulée." });
    expect((await db.traveler.findFirstOrThrow({ where: { bookingId: booking } })).declaredAt).toBeNull();
    const empty = await stay(admin.actor, home, day(240), day(241));
    expect(await act.setDeclaredAction(empty, true)).toEqual({ error: "Enregistrez d'abord les fiches des voyageurs de ce séjour." });
  });

  it("lists yesterday's and today's arrivals not declared, until their adults are declared", async () => {
    const own = await makeHome(sigma, "Riad arrivees");
    const booking = await stay(admin.actor, own, md(0), md(1));
    const ids = async () => (await undeclaredArrivals(sigma, capturesToday(), 500)).items.map((i) => i.bookingId);
    expect(await ids()).toContain(booking);
    await saveTraveler(admin.actor, { bookingId: booking }, null, adultValues("Arrivee"));
    expect(await ids()).toContain(booking);
    await act.setDeclaredAction(booking, true);
    expect(await ids()).not.toContain(booking);
    // Tomorrow's arrival isn't in the alert.
    const later = await stay(admin.actor, own, md(2), md(3));
    expect(await ids()).not.toContain(later);
  });
});

describe("automatic deletion after the retention delay", () => {
  it("--dry-run lists without deleting; the real run deletes only the stays past the delay, scans included, leaving a trace", async () => {
    await db.organization.update({ where: { id: purgeOrg }, data: { identityRetentionDays: 30 } });
    const purgeHome = await makeHome(purgeOrg, "Riad purge");
    const actor = actorOf(purgeOrg);
    const today = capturesToday();
    // Past stays are typed directly (the back-office only types stays not over yet).
    const past = async (checkOutOffset: number) =>
      (
        await db.booking.create({
          data: { organizationId: purgeOrg, listingId: purgeHome, source: "DIRECT", guestName: `Client ${TOKEN}`, checkIn: addDays(today, checkOutOffset - 1), checkOut: addDays(today, checkOutOffset), adults: 1, nightlyCents: 1, cleaningFeeCents: 0, serviceFeeCents: 0, totalCents: 2 },
        })
      ).id;
    const due = await past(-31);
    const exactly = await past(-30);
    const kept = await past(-29);
    for (const b of [due, exactly, kept]) {
      const r = await saveTraveler(actor, { bookingId: b }, null, adultValues("Purge"), PNG);
      expect(r.ok).toBe(true);
    }
    await setDeclared(actor, due, true);
    const keys = (await db.travelerDocument.findMany({ where: { organizationId: purgeOrg }, select: { storageKey: true, traveler: { select: { bookingId: true } } } })).map((d) => ({ key: d.storageKey, booking: d.traveler.bookingId }));
    expect(keys).toHaveLength(3);
    const logs: string[] = [];

    const dry = await purgeIdentities({ dryRun: true, organizationId: purgeOrg, today, log: (l) => logs.push(l) });
    expect(dry.candidates.map((c) => c.bookingId).sort()).toEqual([due, exactly].sort());
    expect(dry).toMatchObject({ dryRun: true, purgedTravelers: 0, purgedDocuments: 0 });
    expect(logs.filter((l) => l.startsWith("[dry-run] would purge"))).toHaveLength(2);
    expect(logs.join("\n")).not.toContain(LAST);
    expect(await db.traveler.count({ where: { organizationId: purgeOrg } })).toBe(3);
    for (const k of keys) await expect(readFile(join(storeDir, k.key))).resolves.toBeDefined();

    const real = await purgeIdentities({ organizationId: purgeOrg, today });
    expect(real).toMatchObject({ dryRun: false, purgedTravelers: 2, purgedDocuments: 2, failedFiles: [] });
    expect((await db.traveler.findMany({ where: { organizationId: purgeOrg }, select: { bookingId: true } })).map((t) => t.bookingId)).toEqual([kept]);
    for (const k of keys) {
      if (k.booking === kept) await expect(readFile(join(storeDir, k.key))).resolves.toBeDefined();
      else await expect(readFile(join(storeDir, k.key))).rejects.toThrow();
    }
    const traces = await db.identityPurge.findMany({ where: { organizationId: purgeOrg } });
    expect(traces.map((t) => t.bookingId).sort()).toEqual([due, exactly].sort());
    expect(traces.find((t) => t.bookingId === due)).toMatchObject({ travelerCount: 1, documentCount: 1, minorCount: 0, declaredCount: 1, retentionDays: 30 });
    expect(traces.find((t) => t.bookingId === exactly)).toMatchObject({ declaredCount: 0 });
    expect(JSON.stringify(traces)).not.toContain(LAST);
    expect(await db.auditLog.count({ where: { organizationId: purgeOrg, action: "identity.purged", actorId: null } })).toBe(2);
    expect(await travelerSummary(purgeOrg, due)).toMatchObject({ travelers: 0, purge: { travelerCount: 1 } });
    // The tax snapshot (no personal data) stays.
    expect(await db.bookingTouristTax.count({ where: { bookingId: due } })).toBe(1);
    // Idempotent; and Sigma's own data was never looked at.
    expect((await purgeIdentities({ organizationId: purgeOrg, today })).candidates).toEqual([]);
    // A day later, the next stay is due.
    expect((await purgeIdentities({ dryRun: true, organizationId: purgeOrg, today: addDays(today, 1) })).candidates.map((c) => c.bookingId)).toEqual([kept]);
  });

  it("the retention delay is a setting of the associés, bounded, audited", async () => {
    as(admin.headers);
    const before = (await db.organization.findUniqueOrThrow({ where: { id: sigma } })).identityRetentionDays;
    expect(await settings.saveRetentionAction({}, form({ retentionDays: "0" }))).toMatchObject({ fieldErrors: { retentionDays: expect.any(String) } });
    expect(await settings.saveRetentionAction({}, form({ retentionDays: String(before + 1) }))).toEqual({ message: "Durée de conservation enregistrée." });
    expect((await db.organization.findUniqueOrThrow({ where: { id: sigma } })).identityRetentionDays).toBe(before + 1);
    expect(await settings.saveRetentionAction({}, form({ retentionDays: String(before) }))).toEqual({ message: "Durée de conservation enregistrée." });
    await expect(db.organization.update({ where: { id: purgeOrg }, data: { identityRetentionDays: 0 } })).rejects.toThrow(/organizations_identity_retention_check/);
    const log = await db.auditLog.findFirstOrThrow({ where: { organizationId: sigma, action: "organization.identity_retention_updated", actorId: admin.id }, orderBy: { createdAt: "desc" } });
    expect(log.details).toEqual({ from: before + 1, to: before });
    as(agent.headers);
    expect(await settings.saveRetentionAction({}, form({ retentionDays: "5" }))).toEqual({ error: "Accès refusé." });
  });
});

describe("taxe de séjour", () => {
  it("snapshots the stay's tax when travellers are recorded, night by night with versioned rates and a home's override; closed, it no longer moves", async () => {
    const actor = actorOf(taxOrg);
    const taxHome = await makeHome(taxOrg, "Riad taxe");
    // The first version may start in the past; the next ones today or later.
    await addOrgTaxRate(actor, { effectiveFrom: "2026-01-01", rateCents: 2_000, minorsExemptUnder: 18, residentsExempt: false, note: "test" });
    await addOrgTaxRate(actor, { effectiveFrom: day(242), rateCents: 3_000, minorsExemptUnder: 18, residentsExempt: false, note: "" });
    await expect(addOrgTaxRate(actor, { effectiveFrom: md(-1), rateCents: 1, minorsExemptUnder: null, residentsExempt: false, note: "" })).rejects.toMatchObject({ code: "PAST_RATE" });
    await expect(addOrgTaxRate(actor, { effectiveFrom: day(242), rateCents: 1, minorsExemptUnder: null, residentsExempt: false, note: "" })).rejects.toMatchObject({ code: "DUPLICATE_RATE" });
    const booking = await stay(actor, taxHome, day(240), day(244), 2, 1);
    // No snapshot until the travellers are recorded (or « Calculer »).
    expect(await getBookingTax(taxOrg, booking)).toBeNull();

    await saveTraveler(actor, { bookingId: booking }, null, adultValues("Taxe"));
    let tax = await getBookingTax(taxOrg, booking);
    // 2 adults (1 recorded + 1 from the booking), the child exempt; 2 nights at 20 MAD, 2 at 30 MAD.
    expect(tax).toMatchObject({ basis: "TRAVELERS", nights: 4, taxableGuestNights: 8, exemptGuestNights: 4, totalCents: 2 * 2 * 2_000 + 2 * 2 * 3_000, missingRateNights: 0 });
    expect(tax!.lines.map((l) => l.rateCents)).toEqual([2_000, 2_000, 3_000, 3_000]);

    // A resident of Morocco recorded; the residents' exemption isn't on: same tax.
    await saveTraveler(actor, { bookingId: booking }, null, adultValues("Resident", { residenceCountry: "MA" }));
    expect((await getBookingTax(taxOrg, booking))!.totalCents).toBe(20_000);

    // A home's own rate from the last night.
    await addListingTaxRate(actor, { listingId: taxHome, effectiveFrom: day(243), rateCents: 5_000, note: "" });
    as(admin.headers);
    // Another organization's associé can't compute it.
    expect(await act.computeTaxAction(booking)).toEqual({ error: "Réservation introuvable." });
    const { computeTaxNow, setTaxClosed } = await import("@/lib/server/declarations/tax");
    await computeTaxNow(actor, booking);
    tax = await getBookingTax(taxOrg, booking);
    expect(tax!.lines.map((l) => l.rateCents)).toEqual([2_000, 2_000, 3_000, 5_000]);
    expect(tax!.totalCents).toBe(2 * (2_000 + 2_000 + 3_000 + 5_000));

    // New dates: the snapshot follows (one night less).
    await rescheduleStaffBooking(actor, booking, { checkIn: new Date(`${day(240)}T00:00:00Z`), checkOut: new Date(`${day(243)}T00:00:00Z`), allowShortStay: true });
    expect((await getBookingTax(taxOrg, booking))!.totalCents).toBe(2 * (2_000 + 2_000 + 3_000));

    // Closed: nothing moves any more, neither a new rate nor a new traveller.
    await setTaxClosed(actor, booking, true);
    await addOrgTaxRate(actor, { effectiveFrom: day(241), rateCents: 9_900, minorsExemptUnder: 18, residentsExempt: false, note: "" });
    await saveTraveler(actor, { bookingId: booking }, null, adultValues("Tard"));
    await expect(computeTaxNow(actor, booking)).rejects.toMatchObject({ code: "TAX_CLOSED" });
    tax = await getBookingTax(taxOrg, booking);
    expect(tax).toMatchObject({ totalCents: 14_000 });
    expect(tax!.closedAt).not.toBeNull();
    expect(await db.auditLog.count({ where: { targetId: booking, action: "tourist_tax.closed" } })).toBe(1);
    // Reopened: recomputed with the new rate from its night and the 3 adults now recorded.
    await setTaxClosed(actor, booking, false);
    await computeTaxNow(actor, booking);
    // Night 3 is back at 30 MAD: the version of day 242 is later than the one of day 241.
    expect((await getBookingTax(taxOrg, booking))!.lines.map((l) => l.rateCents)).toEqual([2_000, 9_900, 3_000]);
    expect((await getBookingTax(taxOrg, booking))!.totalCents).toBe(3 * (2_000 + 9_900 + 3_000));
    // The database bounds the rates.
    await expect(db.touristTaxRate.create({ data: { organizationId: taxOrg, effectiveFrom: new Date(`${day(300)}T00:00:00Z`), rateCents: 100_001 } })).rejects.toThrow(/tourist_tax_rates_check/);
  });

  it("the monthly report by home sums each month's nights, flags estimates, and exports as CSV", async () => {
    const reportOrg = await makeOrg("decl-report");
    const actor = actorOf(reportOrg);
    await addOrgTaxRate(actor, { effectiveFrom: "2026-01-01", rateCents: 1_500, minorsExemptUnder: 18, residentsExempt: false, note: "" });
    const reportHome = await makeHome(reportOrg, "Riad rapport");
    const a = await stay(actor, reportHome, day(260), day(263), 2);
    const b = await stay(actor, reportHome, day(265), day(266), 1);
    await saveTraveler(actor, { bookingId: a }, null, adultValues("Rapport"));
    const snap = await getBookingTax(reportOrg, a);
    expect(snap).toMatchObject({ totalCents: 3 * 2 * 1_500 });
    expect(await getBookingTax(reportOrg, b)).toBeNull();
    for (const month of new Set([day(260).slice(0, 7), day(262).slice(0, 7), day(265).slice(0, 7)])) {
      const report = await monthlyTaxReport(reportOrg, month);
      expect(report.rows).toHaveLength(1);
      const row = report.rows[0];
      const fromA = monthTotals(snap!.lines, month);
      const bIn = day(265).startsWith(month) ? 1 : 0;
      expect(row).toMatchObject({
        listingId: reportHome,
        stays: (fromA.nights ? 1 : 0) + bIn,
        nights: fromA.nights + bIn,
        taxableGuestNights: fromA.taxableGuestNights + bIn,
        totalCents: fromA.totalCents + bIn * 1_500,
        estimated: bIn,
        closed: 0,
      });
      expect(report.totalCents).toBe(row.totalCents);
    }

    // The CSV route, for Sigma's associé (their organization's report only).
    const month = day(260).slice(0, 7);
    const res = await taxRoute(new Request(`http://localhost:3100/api/admin/declarations/taxe?mois=${month}`, { headers: admin.headers }));
    expect(res.status).toBe(200);
    const raw = Buffer.from(await res.arrayBuffer());
    expect([...raw.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = raw.toString("utf8");
    expect(csv).toContain("Mois;Bien;");
    expect(csv).not.toContain("Riad rapport");
    expect((await taxRoute(new Request("http://localhost:3100/api/admin/declarations/taxe?mois=2027-13", { headers: admin.headers }))).status).toBe(400);
    expect((await taxRoute(new Request(`http://localhost:3100/api/admin/declarations/taxe?mois=${month}`, { headers: agent.headers }))).status).toBe(403);
    expect(await db.auditLog.count({ where: { organizationId: sigma, action: "tourist_tax.report_exported", actorId: admin.id } })).toBe(1);
  });

  it("rates are set from Paramètres by the associés: validated, deletable only before they apply", async () => {
    as(admin.headers);
    const future = day(400);
    expect(await settings.addOrgRateAction({}, form({ effectiveFrom: future, rate: "abc" }))).toMatchObject({ fieldErrors: { rate: expect.any(String) } });
    const r = await settings.addOrgRateAction({}, form({ effectiveFrom: future, rate: "12,34", minorsExempt: "on", minorsAge: "16", note: `test ${TOKEN}` }));
    expect(r).toMatchObject({ message: "Taux enregistré." });
    const rate = await db.touristTaxRate.findFirstOrThrow({ where: { organizationId: sigma, note: `test ${TOKEN}` } });
    expect(rate).toMatchObject({ rateCents: 1_234, minorsExemptUnder: 16, residentsExempt: false });
    expect(await settings.addListingRateAction({}, form({ listingId: otherHome, effectiveFrom: future, rate: "5" }))).toMatchObject({ error: "Bien introuvable." });
    expect(await settings.addListingRateAction({}, form({ listingId: home, effectiveFrom: future, useOrgRate: "on" }))).toMatchObject({ message: "Taux du bien enregistré." });
    const own = await db.listingTouristTaxRate.findFirstOrThrow({ where: { listingId: home } });
    expect(own.rateCents).toBeNull();
    const inForce = await db.touristTaxRate.findFirstOrThrow({ where: { organizationId: sigma, effectiveFrom: { lte: new Date() } }, orderBy: { effectiveFrom: "desc" } });
    expect(await settings.deleteRateAction("org", inForce.id)).toMatchObject({ error: expect.stringContaining("déjà en vigueur") });
    as(otherAdmin.headers);
    expect(await settings.deleteRateAction("org", rate.id)).toEqual({ error: "Taux introuvable." });
    as(admin.headers);
    expect(await settings.deleteRateAction("org", rate.id)).toEqual({ message: "Taux supprimé." });
    expect(await settings.deleteRateAction("listing", own.id)).toEqual({ message: "Taux supprimé." });
    expect(await db.auditLog.count({ where: { organizationId: sigma, action: { in: ["tourist_tax.rate_added", "tourist_tax.rate_deleted"] }, actorId: admin.id } })).toBe(4);
  });
});
