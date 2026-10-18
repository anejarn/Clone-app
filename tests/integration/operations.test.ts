import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/generated/prisma/enums";

/**
 * Field tasks (Lot 3a) through the real server functions and server actions: generation on every booking path,
 * idempotency, turnovers, new dates, cancellations; assignment, agents' visibility, the check-list and its photos,
 * the completion rule; refusals and isolation between organizations; task photos in /media. Every row is on homes
 * this file creates (stays from day 200), deleted at the end with the other organization.
 */
const ctx = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({
  headers: async () => ctx.headers,
  cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/cache")>()), updateTag: vi.fn(), refresh: vi.fn() }));

const ops = await import("@/app/admin/operations/actions");
const work = await import("@/app/admin/mes-taches/actions");
const { GET: media } = await import("@/app/media/[...key]/route");
const { cancelStaffBooking, createStaffEntry, rescheduleStaffBooking } = await import("@/lib/server/admin/bookings");
const { parseEntryForm } = await import("@/lib/admin/booking-form");
const { cancelBooking, createBooking } = await import("@/lib/server/bookings");
const { getTask, listTasks, myTasks, taskCounts } = await import("@/lib/server/operations/tasks");
const { syncBookingTasks } = await import("@/lib/operations/sync");
const { DEFAULT_CHECKLISTS } = await import("@/lib/operations/checklist");
const { localInstant } = await import("@/lib/operations/schedule");
const { setUserActive } = await import("@/lib/server/admin/users");
const { db } = await import("@/lib/server/db");
const { LocalStorage } = await import("@/lib/storage/local");
const { setFileStorage } = await import("@/lib/storage");
const { day, sigmaOrgId } = await import("./helpers");
const { signedInMember } = await import("./staff");

type Authorized = import("@/lib/server/authz").Authorized;

const sigma = await sigmaOrgId();
const TOKEN = `O${Date.now()}`;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const at = (n: number) => new Date(`${day(n)}T00:00:00Z`);
const TZ = "Africa/Casablanca";

let storeDir: string;
let admin: { headers: Headers; actor: Authorized };
let agent: { headers: Headers; actor: Authorized };
let agent2: { headers: Headers; actor: Authorized };
let otherAdmin: { headers: Headers; actor: Authorized };
let otherOrg: string;
let otherAgentId: string;
let ownerId: string;
let guestId: string;
let home: string;
let villa: string;
let riad: string;
let otherListing: string;
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
const photoForm = (bytes: Uint8Array, name = "photo.png", type = "image/png") => {
  const f = new FormData();
  f.set("photo", new File([bytes as Uint8Array<ArrayBuffer>], name, { type }));
  return f;
};
const mediaGet = (url: string, headers = new Headers()) =>
  media(new Request(`http://localhost:3100${url}`, { headers }), { params: Promise.resolve({ key: url.replace(/^\/media\//, "").split("/") }) });

async function member(role: Role, organizationId: string | null, twoFactor = true) {
  const m = await signedInMember({ role, organizationId, twoFactor, name: `${role} ${TOKEN}` });
  createdUsers.push(m.user.id);
  const actor: Authorized = { user: { id: m.user.id, name: m.user.name, email: m.user.email, role, twoFactorEnabled: twoFactor }, organizationId: organizationId ?? "" };
  return { headers: m.headers, actor, id: m.user.id };
}

async function makeHome(organizationId: string, owner: string, over: Record<string, unknown> = {}) {
  const place = await db.place.findFirstOrThrow({ where: { slug: "gueliz" } });
  const l = await db.listing.create({
    data: {
      title: `Appartement tâches ${TOKEN}`,
      description: "x",
      organizationId,
      placeId: place.id,
      ownerId: owner,
      address: `Rue ${TOKEN}`,
      lat: 31.63,
      lng: -8.0,
      maxGuests: 4,
      minNights: 1,
      priceCents: 80_000,
      cleaningFeeCents: 10_000,
      ...over,
    },
  });
  ownListings.push(l.id);
  return l.id;
}

function entry(kind: "directe" | "plateforme" | "blocage", listingId: string, from: number, to: number) {
  const values: Record<string, string> = { listingId, checkIn: day(from), checkOut: day(to), adults: "2", children: "0", note: "" };
  if (kind === "directe") Object.assign(values, { guestName: "Salma Bennani", guestPhone: "+212 6 11 22 33 44", channel: "WHATSAPP", nightly: "", cleaning: "" });
  if (kind === "plateforme") Object.assign(values, { source: "BOOKING", externalRef: `BK${TOKEN.slice(-7)}${from}` });
  if (kind === "blocage") values.note = "Séjour du propriétaire";
  const parsed = parseEntryForm(kind, values);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.fieldErrors));
  return parsed.entry;
}

const tasksOf = (bookingId: string) =>
  db.task.findMany({ where: { bookingId }, include: { items: { orderBy: { position: "asc" } } }, orderBy: { type: "asc" } });
const byType = async (bookingId: string) => Object.fromEntries((await tasksOf(bookingId)).map((t) => [t.type, t]));

/** A fresh direct booking on `listingId` and its cleaning task. */
async function stayWithCleaning(listingId: string, from: number, to: number) {
  const { id } = await createStaffEntry(admin.actor, entry("directe", listingId, from, to));
  const t = await byType(id);
  return { bookingId: id, cleaning: t.CLEANING, checkin: t.CHECKIN, linen: t.LINEN };
}

beforeAll(async () => {
  storeDir = await mkdtemp(join(tmpdir(), "sigma-tasks-"));
  setFileStorage(new LocalStorage(storeDir));
  const owner = await db.user.create({ data: { name: `Owner ${TOKEN}`, email: `owner-${TOKEN.toLowerCase()}@test.sigma.test`, role: "OWNER", organizationId: sigma } });
  ownerId = owner.id;
  createdUsers.push(owner.id);
  home = await makeHome(sigma, owner.id);
  villa = await makeHome(sigma, owner.id, { title: `Villa tâches ${TOKEN}`, checkInMinutes: 16 * 60, checkOutMinutes: 10 * 60 });
  riad = await makeHome(sigma, owner.id, { title: `Riad tâches ${TOKEN}` });

  admin = await member("ADMIN", sigma);
  agent = await member("AGENT", sigma);
  agent2 = await member("AGENT", sigma);

  otherOrg = (await db.organization.create({ data: { name: "Autre conciergerie", slug: `ops-${TOKEN.toLowerCase()}` } })).id;
  const otherOwner = await db.user.create({ data: { name: "Owner other", email: `owner-other-${TOKEN.toLowerCase()}@test.sigma.test`, role: "OWNER", organizationId: otherOrg } });
  otherListing = await makeHome(otherOrg, otherOwner.id);
  otherAdmin = await member("ADMIN", otherOrg);
  otherAgentId = (await member("AGENT", otherOrg)).id;

  const guest = await member("GUEST", null, false);
  guestId = guest.id;
  refused.set("anonymous", new Headers());
  refused.set("guest", guest.headers);
  refused.set("owner", (await member("OWNER", sigma, false)).headers);
  refused.set("admin without 2FA", (await member("ADMIN", sigma, false)).headers);
});

beforeEach(() => as(admin.headers));

afterAll(async () => {
  const bookingIds = (await db.booking.findMany({ where: { listingId: { in: ownListings } }, select: { id: true } })).map((b) => b.id);
  const taskIds = (await db.task.findMany({ where: { listingId: { in: ownListings } }, select: { id: true } })).map((t) => t.id);
  await db.auditLog.deleteMany({ where: { OR: [{ targetId: { in: [...bookingIds, ...taskIds, ...createdUsers] } }, { organizationId: otherOrg }] } });
  // Tasks, their items and photos go with the listings and bookings (cascade).
  await db.booking.deleteMany({ where: { listingId: { in: ownListings } } });
  await db.listing.deleteMany({ where: { id: { in: ownListings } } });
  await db.checklistTemplate.deleteMany({ where: { organizationId: otherOrg } });
  await db.user.deleteMany({ where: { OR: [{ organizationId: otherOrg }, { id: { in: createdUsers } }] } });
  await db.organization.delete({ where: { id: otherOrg } });
  setFileStorage(undefined);
  await rm(storeDir, { recursive: true, force: true });
});

describe("generation", () => {
  it("a phone booking gets linen and welcome on arrival and a cleaning on departure, in Marrakech time, with their check-lists", async () => {
    const { id } = await createStaffEntry(admin.actor, entry("directe", home, 200, 203));
    const t = await byType(id);
    expect(Object.keys(t).sort()).toEqual(["CHECKIN", "CLEANING", "LINEN"]);
    expect(t.LINEN.scheduledDate).toEqual(at(200));
    expect(t.CHECKIN.scheduledDate).toEqual(at(200));
    expect(t.CLEANING.scheduledDate).toEqual(at(203));
    expect(t.CHECKIN.startsAt).toEqual(localInstant(at(200), 15 * 60, TZ));
    expect(t.CHECKIN.endsAt).toEqual(localInstant(at(200), 17 * 60, TZ));
    expect(t.CLEANING.startsAt).toEqual(localInstant(at(203), 11 * 60, TZ));
    expect(t.CLEANING.endsAt).toEqual(localInstant(at(203), 15 * 60, TZ));
    for (const type of ["LINEN", "CHECKIN", "CLEANING"] as const) {
      expect(t[type]).toMatchObject({ status: "TODO", organizationId: sigma, listingId: home, assigneeId: null, turnover: false });
      expect(t[type].items.map((i) => [i.label, i.requiresPhoto])).toEqual(DEFAULT_CHECKLISTS[type].map((i) => [i.label, i.requiresPhoto]));
    }
  });

  it("a home's own check-in and check-out times win over the organization's", async () => {
    const { id } = await createStaffEntry(admin.actor, entry("directe", villa, 200, 202));
    const t = await byType(id);
    expect(t.CHECKIN.startsAt).toEqual(localInstant(at(200), 16 * 60, TZ));
    expect(t.CLEANING.startsAt).toEqual(localInstant(at(202), 10 * 60, TZ));
    expect(t.CLEANING.endsAt).toEqual(localInstant(at(202), 16 * 60, TZ));
  });

  it("a platform booking typed by hand and a booking from the site get them too; an owner block gets none", async () => {
    const platform = await createStaffEntry(admin.actor, entry("plateforme", home, 205, 207));
    expect((await tasksOf(platform.id)).map((t) => t.type).sort()).toEqual(["CHECKIN", "CLEANING", "LINEN"]);
    const site = await createBooking(sigma, guestId, { listingId: home, checkIn: day(208), checkOut: day(210), adults: 2, children: 0, infants: 0, pets: 0 });
    expect((await tasksOf(site.id)).map((t) => t.type).sort()).toEqual(["CHECKIN", "CLEANING", "LINEN"]);
    const block = await createStaffEntry(admin.actor, entry("blocage", home, 211, 214));
    expect(await tasksOf(block.id)).toEqual([]);
  });

  it("is idempotent: syncing again creates, moves and cancels nothing", async () => {
    const { bookingId } = await stayWithCleaning(home, 215, 217);
    const before = JSON.stringify(await tasksOf(bookingId));
    expect(await db.$transaction((tx) => syncBookingTasks(tx, bookingId))).toEqual({ created: 0, moved: 0, cancelled: 0 });
    expect(await db.$transaction((tx) => syncBookingTasks(tx, bookingId))).toEqual({ created: 0, moved: 0, cancelled: 0 });
    expect(JSON.stringify(await tasksOf(bookingId))).toBe(before);
    // A task deleted by mistake comes back; the others are untouched.
    await db.task.deleteMany({ where: { bookingId, type: "LINEN" } });
    expect(await db.$transaction((tx) => syncBookingTasks(tx, bookingId))).toEqual({ created: 1, moved: 0, cancelled: 0 });
    expect(await db.task.count({ where: { bookingId } })).toBe(3);
  });

  it("flags a same-day turnover on the cleaning, and clears it when the next stay goes away", async () => {
    const first = await stayWithCleaning(riad, 220, 223);
    expect(first.cleaning.turnover).toBe(false);
    const next = await createStaffEntry(admin.actor, entry("directe", riad, 223, 225));
    expect((await byType(first.bookingId)).CLEANING.turnover).toBe(true);
    expect((await byType(next.id)).CLEANING.turnover).toBe(false);
    await cancelStaffBooking(admin.actor, next.id);
    expect((await byType(first.bookingId)).CLEANING.turnover).toBe(false);
    // An owner arriving the same day needs the home ready too.
    const block = await createStaffEntry(admin.actor, entry("blocage", riad, 223, 226));
    expect((await byType(first.bookingId)).CLEANING.turnover).toBe(true);
    // Moving the block a day later: no turnover any more.
    await rescheduleStaffBooking(admin.actor, block.id, { checkIn: at(224), checkOut: at(226), allowShortStay: false });
    expect((await byType(first.bookingId)).CLEANING.turnover).toBe(false);
    // Moving the stay so that it leaves the day the owner arrives: turnover again.
    await rescheduleStaffBooking(admin.actor, first.bookingId, { checkIn: at(221), checkOut: at(224), allowShortStay: false });
    expect((await byType(first.bookingId)).CLEANING.turnover).toBe(true);
  });
});

describe("new dates and cancellations", () => {
  it("new dates move the tasks not started yet; a started one stays; an associé's new time survives a re-sync", async () => {
    const s = await stayWithCleaning(home, 230, 233);
    await db.task.update({ where: { id: s.checkin.id }, data: { status: "IN_PROGRESS", startedAt: new Date() } });
    await rescheduleStaffBooking(admin.actor, s.bookingId, { checkIn: at(231), checkOut: at(235), allowShortStay: false });
    const t = await byType(s.bookingId);
    expect(t.LINEN.scheduledDate).toEqual(at(231));
    expect(t.CLEANING.scheduledDate).toEqual(at(235));
    expect(t.CLEANING.startsAt).toEqual(localInstant(at(235), 11 * 60, TZ));
    expect(t.CHECKIN.scheduledDate).toEqual(at(230));

    as(admin.headers);
    expect(await ops.rescheduleTaskAction(t.CLEANING.id, {}, form({ day: day(235), start: "12:30", end: "16:00" }))).toEqual({ message: "Horaire enregistré." });
    await db.$transaction((tx) => syncBookingTasks(tx, s.bookingId));
    expect((await byType(s.bookingId)).CLEANING.startsAt).toEqual(localInstant(at(235), 12 * 60 + 30, TZ));
  });

  it("a cancelled stay cancels its TODO tasks and keeps the started and done ones", async () => {
    const s = await stayWithCleaning(villa, 240, 242);
    await db.task.update({ where: { id: s.linen.id }, data: { status: "DONE", startedAt: new Date(), completedAt: new Date() } });
    await db.task.update({ where: { id: s.checkin.id }, data: { status: "IN_PROGRESS", startedAt: new Date() } });
    await cancelStaffBooking(admin.actor, s.bookingId);
    const t = await byType(s.bookingId);
    expect([t.LINEN.status, t.CHECKIN.status, t.CLEANING.status]).toEqual(["DONE", "IN_PROGRESS", "CANCELLED"]);
    expect(t.CLEANING.cancelledAt).not.toBeNull();
  });

  it("a guest cancelling on the site cancels the tasks too", async () => {
    const site = await createBooking(sigma, guestId, { listingId: villa, checkIn: day(245), checkOut: day(247), adults: 1, children: 0, infants: 0, pets: 0 });
    await cancelBooking(sigma, guestId, site.id);
    expect((await tasksOf(site.id)).map((t) => t.status)).toEqual(["CANCELLED", "CANCELLED", "CANCELLED"]);
  });
});

describe("assignment", () => {
  it("an associé assigns a task to an agent of the organization, audited; the agent then sees it", async () => {
    const s = await stayWithCleaning(home, 250, 252);
    expect(await getTask(agent.actor, s.cleaning.id)).toBeNull();
    expect(await ops.assignTaskAction(s.cleaning.id, {}, form({ assigneeId: agent.actor.user.id }))).toEqual({ message: "Tâche affectée." });
    expect((await getTask(agent.actor, s.cleaning.id))?.assignee).toEqual({ id: agent.actor.user.id, name: agent.actor.user.name });
    const audit = await db.auditLog.findFirst({ where: { targetId: s.cleaning.id, action: "task.assigned" } });
    expect(audit).toMatchObject({ organizationId: sigma, actorId: admin.actor.user.id, targetType: "task", details: { type: "CLEANING", from: null, to: agent.actor.user.id } });
    // Taken back.
    expect(await ops.assignTaskAction(s.cleaning.id, {}, form({ assigneeId: "" }))).toEqual({ message: "Tâche désaffectée." });
    expect(await getTask(agent.actor, s.cleaning.id)).toBeNull();
  });

  it("only to an active associé or agent of the same organization", async () => {
    const s = await stayWithCleaning(home, 254, 256);
    const refusal = { error: "Choisissez un membre actif de l'équipe (associé ou agent)." };
    for (const id of [ownerId, guestId, otherAgentId, otherAdmin.actor.user.id, "unknown-user"]) {
      expect(await ops.assignTaskAction(s.cleaning.id, {}, form({ assigneeId: id })), id).toEqual(refusal);
    }
    // The database refuses it too (tasks_assignee_check).
    await expect(db.task.update({ where: { id: s.cleaning.id }, data: { assigneeId: otherAgentId } })).rejects.toThrow(/tasks_assignee_check/);
    const leaving = await member("AGENT", sigma);
    expect(await ops.assignTaskAction(s.cleaning.id, {}, form({ assigneeId: leaving.id }))).toEqual({ message: "Tâche affectée." });
    // Deactivating the agent gives their open tasks back; they can't be given a task any more.
    await setUserActive(admin.actor, leaving.id, false);
    expect((await db.task.findUniqueOrThrow({ where: { id: s.cleaning.id } })).assigneeId).toBeNull();
    expect(await ops.assignTaskAction(s.cleaning.id, {}, form({ assigneeId: leaving.id }))).toEqual(refusal);
  });

  it("agents see only their own tasks; associés see them all", async () => {
    const s = await stayWithCleaning(villa, 258, 260);
    await ops.assignTaskAction(s.cleaning.id, {}, form({ assigneeId: agent.actor.user.id }));
    await ops.assignTaskAction(s.checkin.id, {}, form({ assigneeId: agent2.actor.user.id }));
    const mine = await myTasks(agent.actor, at(258), at(261));
    expect(mine.map((t) => t.id)).toEqual([s.cleaning.id]);
    expect(mine[0]).not.toHaveProperty("amounts");
    expect((await myTasks(agent2.actor, at(258), at(261))).map((t) => t.id)).toEqual([s.checkin.id]);
    expect(await getTask(agent.actor, s.checkin.id)).toBeNull();
    expect(await getTask(agent.actor, s.linen.id)).toBeNull();
    expect(await getTask(admin.actor, s.linen.id)).not.toBeNull();
    const all = await listTasks(sigma, { from: at(258), to: at(261), listingId: villa });
    expect(all.items.map((t) => t.type).sort()).toEqual(["CHECKIN", "CLEANING", "LINEN"]);
    expect((await listTasks(sigma, { from: at(258), to: at(261), listingId: villa, assignee: "none" })).items.map((t) => t.id)).toEqual([s.linen.id]);
    expect((await listTasks(sigma, { from: at(258), to: at(261), listingId: villa, assignee: agent.actor.user.id, type: "CLEANING" })).items).toHaveLength(1);

    // An agent acting on a colleague's task, or an unassigned one: "not found".
    as(agent.headers);
    for (const id of [s.checkin.id, s.linen.id]) {
      expect(await work.startTaskAction(id)).toEqual({ error: "Tâche introuvable." });
      expect(await work.completeTaskAction(id)).toEqual({ error: "Tâche introuvable." });
      expect(await work.uploadTaskPhotoAction(id, "x", photoForm(PNG))).toEqual({ error: "Tâche introuvable." });
    }
    // And agents don't run Opérations.
    expect(await ops.assignTaskAction(s.linen.id, {}, form({ assigneeId: agent.actor.user.id }))).toEqual({ error: "Accès refusé." });
    expect(await ops.cancelTaskAction(s.linen.id, {}, form({ confirm: "on" }))).toEqual({ error: "Accès refusé." });
    expect((await db.task.findUniqueOrThrow({ where: { id: s.linen.id } })).assigneeId).toBeNull();
  });
});

describe("doing a task", () => {
  it("start, tick, photo, finish: refused while a required photo is missing, done once it is there", async () => {
    const s = await stayWithCleaning(riad, 262, 264);
    await ops.assignTaskAction(s.cleaning.id, {}, form({ assigneeId: agent.actor.user.id }));
    as(agent.headers);
    const items = s.cleaning.items;
    const required = items.filter((i) => i.requiresPhoto);
    expect(required.length).toBeGreaterThan(0);

    // Nothing before it is started.
    expect(await work.toggleItemAction(s.cleaning.id, items[0].id, true)).toEqual({ error: "Commencez d'abord la tâche (« Commencer »)." });
    expect(await work.uploadTaskPhotoAction(s.cleaning.id, required[0].id, photoForm(PNG))).toEqual({ error: "Commencez d'abord la tâche (« Commencer »)." });
    expect(await work.completeTaskAction(s.cleaning.id)).toEqual({ error: "Commencez d'abord la tâche (« Commencer »)." });
    expect(await work.startTaskAction(s.cleaning.id)).toEqual({ message: "Tâche commencée." });
    expect(await work.startTaskAction(s.cleaning.id)).toEqual({ error: "Cette tâche est déjà en cours." });

    for (const i of items) expect(await work.toggleItemAction(s.cleaning.id, i.id, true)).toEqual({});
    // Every item ticked, photos missing: refused, with what is missing.
    const r = await work.completeTaskAction(s.cleaning.id);
    expect(r.error).toMatch(/^Photos? obligatoires? manquantes? : /);
    for (const i of required) expect(r.error).toContain(i.label);

    // A file that isn't an image is refused; an item of another task is not found.
    expect(await work.uploadTaskPhotoAction(s.cleaning.id, required[0].id, photoForm(new TextEncoder().encode("not an image"), "x.png"))).toEqual({
      error: "Format non accepté : JPEG, PNG ou WebP uniquement.",
    });
    expect(await work.uploadTaskPhotoAction(s.cleaning.id, s.checkin.items[0].id, photoForm(PNG))).toEqual({ error: "Élément introuvable." });

    for (const i of required.slice(0, -1)) expect(await work.uploadTaskPhotoAction(s.cleaning.id, i.id, photoForm(PNG))).toEqual({ message: "Photo ajoutée." });
    expect((await work.completeTaskAction(s.cleaning.id)).error).toBe(`Photo obligatoire manquante : ${required.at(-1)!.label}.`);
    // Unticking an item blocks it too.
    await work.toggleItemAction(s.cleaning.id, items[0].id, false);
    expect(await work.uploadTaskPhotoAction(s.cleaning.id, required.at(-1)!.id, photoForm(PNG))).toEqual({ message: "Photo ajoutée." });
    expect((await work.completeTaskAction(s.cleaning.id)).error).toBe(`Il reste à cocher : ${items[0].label}.`);
    await work.toggleItemAction(s.cleaning.id, items[0].id, true);

    expect(await work.completeTaskAction(s.cleaning.id)).toEqual({ message: "Tâche terminée. Merci !" });
    const done = await db.task.findUniqueOrThrow({ where: { id: s.cleaning.id }, include: { photos: true, items: true } });
    expect(done.status).toBe("DONE");
    expect(done.completedAt).not.toBeNull();
    expect(done.photos).toHaveLength(required.length);
    expect(done.photos.every((p) => p.storageKey.startsWith(`tasks/${sigma}/${s.cleaning.id}/`) && p.url === `/media/${p.storageKey}` && p.uploadedById === agent.actor.user.id)).toBe(true);
    expect(done.items.every((i) => i.checkedById === agent.actor.user.id)).toBe(true);
    const audit = await db.auditLog.findMany({ where: { targetId: s.cleaning.id, action: "task.status_changed" }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => (a.details as { to: string }).to)).toEqual(["IN_PROGRESS", "DONE"]);

    // Done: nothing changes any more, until an associé reopens it.
    expect(await work.toggleItemAction(s.cleaning.id, items[0].id, false)).toEqual({ error: "Cette tâche est déjà faite." });
    expect(await work.deleteTaskPhotoAction(s.cleaning.id, done.photos[0].id)).toEqual({ error: "Cette tâche est déjà faite." });
    as(admin.headers);
    expect(await ops.reopenTaskAction(s.cleaning.id, {}, form({}))).toEqual({ message: "Tâche remise « à faire »." });
    expect((await db.task.findUniqueOrThrow({ where: { id: s.cleaning.id } })).status).toBe("TODO");
  });

  it("the server refuses DONE without the photo even if the database is ticked by hand", async () => {
    const s = await stayWithCleaning(villa, 266, 268);
    await db.task.update({ where: { id: s.checkin.id }, data: { status: "IN_PROGRESS", startedAt: new Date() } });
    await db.taskChecklistItem.updateMany({ where: { taskId: s.checkin.id }, data: { checkedAt: new Date() } });
    expect(await work.completeTaskAction(s.checkin.id)).toEqual({ error: "Photo obligatoire manquante : Photo des compteurs (électricité, eau)." });
    expect((await db.task.findUniqueOrThrow({ where: { id: s.checkin.id } })).status).toBe("IN_PROGRESS");
  });

  it("a photo can be deleted while the task is in progress, and its file goes with it", async () => {
    const s = await stayWithCleaning(home, 270, 272);
    await work.startTaskAction(s.linen.id);
    const item = s.linen.items.find((i) => i.requiresPhoto)!;
    await work.uploadTaskPhotoAction(s.linen.id, item.id, photoForm(PNG));
    const photo = await db.taskPhoto.findFirstOrThrow({ where: { taskId: s.linen.id } });
    expect((await mediaGet(photo.url, admin.headers)).status).toBe(200);
    expect(await work.deleteTaskPhotoAction(s.linen.id, photo.id)).toEqual({ message: "Photo supprimée." });
    expect(await db.taskPhoto.count({ where: { taskId: s.linen.id } })).toBe(0);
    expect(await new LocalStorage(storeDir).get(photo.storageKey)).toBeNull();
  });
});

describe("Opérations: manual tasks, cancel", () => {
  async function createTask(values: Record<string, string>) {
    try {
      return { state: await ops.createTaskAction({}, form(values)) };
    } catch (e) {
      const id = /\/admin\/operations\/([^?;]+)\?cree=1/.exec(String((e as { digest?: string }).digest ?? ""))?.[1];
      if (!id) throw e;
      return { id };
    }
  }
  const manual = (over: Record<string, string> = {}) => ({
    listingId: home,
    type: "CLEANING",
    day: day(274),
    start: "10:00",
    end: "12:00",
    title: "",
    notes: "Ménage après le séjour du propriétaire",
    assigneeId: agent.actor.user.id,
    ...over,
  });

  it("an associé types a task by hand: check-list copied, assigned, audited", async () => {
    const { id } = await createTask(manual());
    expect(id).toBeDefined();
    const t = await db.task.findUniqueOrThrow({ where: { id: id! }, include: { items: true } });
    expect(t).toMatchObject({ organizationId: sigma, listingId: home, bookingId: null, type: "CLEANING", assigneeId: agent.actor.user.id, createdById: admin.actor.user.id, scheduledDate: at(274) });
    expect(t.startsAt).toEqual(localInstant(at(274), 600, TZ));
    expect(t.items).toHaveLength(DEFAULT_CHECKLISTS.CLEANING.length);
    expect(await db.auditLog.count({ where: { targetId: id!, action: "task.created" } })).toBe(1);
    expect((await getTask(agent.actor, id!))?.notes).toBe("Ménage après le séjour du propriétaire");

    const other = await createTask(manual({ type: "OTHER", title: "Acheter des ampoules", assigneeId: "" }));
    expect((await db.task.findUniqueOrThrow({ where: { id: other.id! }, include: { items: true } })).items.map((i) => i.label)).toEqual(["Tâche réalisée"]);
  });

  it("refuses a past day, another organization's home, a window ending before it starts", async () => {
    expect((await createTask(manual({ day: day(-3) }))).state).toEqual({ error: "Choisissez aujourd'hui ou un jour à venir.", values: expect.any(Object) });
    expect((await createTask(manual({ listingId: otherListing }))).state).toEqual({ error: "Bien introuvable.", values: expect.any(Object) });
    expect((await createTask(manual({ start: "14:00", end: "13:00" }))).state).toMatchObject({ error: "Corrigez les champs signalés.", fieldErrors: { end: expect.any(String) } });
  });

  it("an associé cancels a task (with confirmation) and reopens it", async () => {
    const s = await stayWithCleaning(riad, 276, 278);
    expect(await ops.cancelTaskAction(s.linen.id, {}, form({}))).toEqual({ error: "Cochez la case pour confirmer." });
    expect(await ops.cancelTaskAction(s.linen.id, {}, form({ confirm: "on" }))).toEqual({ message: "Tâche annulée." });
    expect(await ops.cancelTaskAction(s.linen.id, {}, form({ confirm: "on" }))).toEqual({ error: "Cette tâche est annulée." });
    expect(await ops.reopenTaskAction(s.linen.id, {}, form({}))).toEqual({ message: "Tâche remise « à faire »." });
  });
});

describe("access", () => {
  it("anonymous visitors, guests, owners and admins without 2FA are refused by every action, and nothing changes", async () => {
    const s = await stayWithCleaning(home, 280, 282);
    const before = JSON.stringify(await tasksOf(s.bookingId));
    const expected: Record<string, string> = {
      anonymous: "Connectez-vous pour continuer.",
      guest: "Accès refusé.",
      owner: "Accès refusé.",
      "admin without 2FA": "Activez la double authentification pour accéder à l'espace équipe.",
    };
    const item = s.cleaning.items[0].id;
    for (const [name, headers] of refused) {
      as(headers);
      const want = { error: expected[name] };
      expect(await ops.createTaskAction({}, form({ listingId: home, type: "OTHER", title: "x", day: day(283), start: "10:00", end: "11:00", notes: "", assigneeId: "" })), name).toEqual(want);
      expect(await ops.assignTaskAction(s.cleaning.id, {}, form({ assigneeId: admin.actor.user.id })), name).toEqual(want);
      expect(await ops.rescheduleTaskAction(s.cleaning.id, {}, form({ day: day(283), start: "10:00", end: "11:00" })), name).toEqual(want);
      expect(await ops.updateTaskNotesAction(s.cleaning.id, {}, form({ notes: "x" })), name).toEqual(want);
      expect(await ops.cancelTaskAction(s.cleaning.id, {}, form({ confirm: "on" })), name).toEqual(want);
      expect(await ops.reopenTaskAction(s.cleaning.id, {}, form({})), name).toEqual(want);
      expect(await work.startTaskAction(s.cleaning.id), name).toEqual(want);
      expect(await work.toggleItemAction(s.cleaning.id, item, true), name).toEqual(want);
      expect(await work.uploadTaskPhotoAction(s.cleaning.id, item, photoForm(PNG)), name).toEqual(want);
      expect(await work.deleteTaskPhotoAction(s.cleaning.id, "x"), name).toEqual(want);
      expect(await work.completeTaskAction(s.cleaning.id), name).toEqual(want);
    }
    expect(JSON.stringify(await tasksOf(s.bookingId))).toBe(before);
  });

  it("another organization's associé gets 404 for every task of Sigma, and Sigma's for theirs", async () => {
    const s = await stayWithCleaning(home, 284, 286);
    expect(await getTask(otherAdmin.actor, s.cleaning.id)).toBeNull();
    expect((await listTasks(otherOrg, { from: at(284), to: at(287) })).items).toEqual([]);
    as(otherAdmin.headers);
    for (const r of [
      await ops.assignTaskAction(s.cleaning.id, {}, form({ assigneeId: otherAdmin.actor.user.id })),
      await ops.rescheduleTaskAction(s.cleaning.id, {}, form({ day: day(286), start: "10:00", end: "11:00" })),
      await ops.cancelTaskAction(s.cleaning.id, {}, form({ confirm: "on" })),
      await work.startTaskAction(s.cleaning.id),
      await work.completeTaskAction(s.cleaning.id),
      await work.uploadTaskPhotoAction(s.cleaning.id, s.cleaning.items[0].id, photoForm(PNG)),
    ]) {
      expect(r).toEqual({ error: "Tâche introuvable." });
    }
    expect(await db.taskPhoto.count({ where: { taskId: s.cleaning.id } })).toBe(0);

    // Their own home, their own tasks (their organization gets its default check-lists).
    const theirs = await createStaffEntry(otherAdmin.actor, entry("directe", otherListing, 284, 286));
    const t = await byType(theirs.id);
    expect(t.CLEANING.organizationId).toBe(otherOrg);
    expect(t.CLEANING.items).toHaveLength(DEFAULT_CHECKLISTS.CLEANING.length);
    expect(await getTask(admin.actor, t.CLEANING.id)).toBeNull();
    as(admin.headers);
    expect(await ops.assignTaskAction(t.CLEANING.id, {}, form({ assigneeId: agent.actor.user.id }))).toEqual({ error: "Tâche introuvable." });
  });

  it("task photos are served to the organization's staff only, never cached", async () => {
    const s = await stayWithCleaning(villa, 288, 290);
    await work.startTaskAction(s.cleaning.id);
    const item = s.cleaning.items.find((i) => i.requiresPhoto)!;
    expect(await work.uploadTaskPhotoAction(s.cleaning.id, item.id, photoForm(PNG))).toEqual({ message: "Photo ajoutée." });
    const { url } = await db.taskPhoto.findFirstOrThrow({ where: { taskId: s.cleaning.id } });
    for (const [name, headers] of [...refused, ["other organization", otherAdmin.headers] as const]) {
      expect((await mediaGet(url, headers)).status, name).toBe(404);
    }
    // Staff of the organization, the task's agent or not.
    for (const headers of [admin.headers, agent.headers, agent2.headers]) {
      const r = await mediaGet(url, headers);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toBe("image/png");
      expect(r.headers.get("cache-control")).toBe("private, no-store");
    }
    expect((await mediaGet(`/media/tasks/${sigma}/${s.cleaning.id}/unknown.png`, admin.headers)).status).toBe(404);
  });

  it("the dashboard counts today's tasks and the unassigned ones", async () => {
    const today = at(292);
    const before = await taskCounts(sigma, today);
    const s = await stayWithCleaning(riad, 292, 294);
    const after = await taskCounts(sigma, today);
    expect(after.tasksToday - before.tasksToday).toBe(2);
    expect(after.tasksUnassigned - before.tasksUnassigned).toBe(3);
    await ops.assignTaskAction(s.linen.id, {}, form({ assigneeId: agent.actor.user.id }));
    expect((await taskCounts(sigma, today)).tasksUnassigned - before.tasksUnassigned).toBe(2);
  });
});
