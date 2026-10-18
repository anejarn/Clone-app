import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "@/lib/generated/prisma/enums";

/**
 * « Ma journée » (Lot 3b): GET /api/admin/journee and POST /api/admin/journee/operations through the real Route
 * Handlers. A day done offline then sent in one go; idempotent replays (sequential and concurrent); conflicts when the
 * task was reassigned or cancelled meanwhile (the server wins, the answer is recorded); other agents' and other
 * organizations' tasks; refusals. Every row is on a home this file creates (stays from day 320).
 */
const { GET: dayApi } = await import("@/app/api/admin/journee/route");
const { POST: opsApi } = await import("@/app/api/admin/journee/operations/route");
const { createStaffEntry } = await import("@/lib/server/admin/bookings");
const { parseEntryForm } = await import("@/lib/admin/booking-form");
const { db } = await import("@/lib/server/db");
const { LocalStorage } = await import("@/lib/storage/local");
const { setFileStorage } = await import("@/lib/storage");
const { day, sigmaOrgId } = await import("./helpers");
const { signedInMember } = await import("./staff");

type Authorized = import("@/lib/server/authz").Authorized;
type FieldOpResult = import("@/lib/operations/field-ops").FieldOpResult;

const sigma = await sigmaOrgId();
const TOKEN = `J${Date.now()}`;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const ORIGIN = "http://localhost:3100";

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
let home: string;
let otherListing: string;
const createdUsers: string[] = [];
const ownListings: string[] = [];
let n = 0;
const opId = () => `${TOKEN}-op-${(n += 1)}`.slice(-64);

async function member(role: Role, organizationId: string | null, twoFactor = true): Promise<Member> {
  const m = await signedInMember({ role, organizationId, twoFactor, name: `${role} ${TOKEN}` });
  createdUsers.push(m.user.id);
  const actor: Authorized = { user: { id: m.user.id, name: m.user.name, email: m.user.email, role, twoFactorEnabled: twoFactor }, organizationId: organizationId ?? "" };
  return { headers: m.headers, actor, id: m.user.id };
}

async function makeHome(organizationId: string, owner: string) {
  const place = await db.place.findFirstOrThrow({ where: { slug: "gueliz" } });
  const l = await db.listing.create({
    data: { title: `Appartement journée ${TOKEN}`, description: "x", organizationId, placeId: place.id, ownerId: owner, address: `Rue ${TOKEN}`, lat: 31.63, lng: -8.0, maxGuests: 4, minNights: 1, priceCents: 80_000 },
  });
  ownListings.push(l.id);
  return l.id;
}

/** A stay on `listingId` (by `by`), its cleaning task given to `assignee`, with its items. */
async function cleaningFor(by: Member, listingId: string, from: number, assignee: string) {
  const parsed = parseEntryForm("directe", { listingId, checkIn: day(from), checkOut: day(from + 2), adults: "2", children: "0", note: "", guestName: "Salma", guestPhone: "+212 6 11 22 33 44", channel: "PHONE", nightly: "", cleaning: "" });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.fieldErrors));
  const { id } = await createStaffEntry(by.actor, parsed.entry);
  const t = await db.task.findFirstOrThrow({ where: { bookingId: id, type: "CLEANING" }, include: { items: { orderBy: { position: "asc" } } } });
  await db.task.update({ where: { id: t.id }, data: { assigneeId: assignee } });
  return t;
}

/** POST one operation as the phone does (multipart). */
async function send(headers: Headers, op: Record<string, unknown>, photo?: Uint8Array, extra: Record<string, string> = {}) {
  const form = new FormData();
  form.set("op", JSON.stringify(op));
  if (photo) form.set("photo", new File([photo as Uint8Array<ArrayBuffer>], "photo.png", { type: "image/png" }));
  const h = new Headers(headers);
  for (const [k, v] of Object.entries(extra)) h.set(k, v);
  const res = await opsApi(new Request(`${ORIGIN}/api/admin/journee/operations`, { method: "POST", headers: h, body: form }));
  return { status: res.status, body: (await res.json()) as { result?: FieldOpResult; error?: { code: string; message: string } } };
}
const result = async (...args: Parameters<typeof send>) => {
  const r = await send(...args);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.result!;
};

beforeAll(async () => {
  storeDir = await mkdtemp(join(tmpdir(), "sigma-journee-"));
  setFileStorage(new LocalStorage(storeDir));
  const owner = await db.user.create({ data: { name: `Owner ${TOKEN}`, email: `owner-${TOKEN.toLowerCase()}@test.sigma.test`, role: "OWNER", organizationId: sigma } });
  createdUsers.push(owner.id);
  home = await makeHome(sigma, owner.id);
  admin = await member("ADMIN", sigma);
  agent = await member("AGENT", sigma);
  agent2 = await member("AGENT", sigma);
  otherOrg = (await db.organization.create({ data: { name: "Autre conciergerie", slug: `jr-${TOKEN.toLowerCase()}` } })).id;
  const otherOwner = await db.user.create({ data: { name: "Owner other", email: `owner-other-${TOKEN.toLowerCase()}@test.sigma.test`, role: "OWNER", organizationId: otherOrg } });
  otherListing = await makeHome(otherOrg, otherOwner.id);
  otherAdmin = await member("ADMIN", otherOrg);
});

afterAll(async () => {
  const bookingIds = (await db.booking.findMany({ where: { listingId: { in: ownListings } }, select: { id: true } })).map((b) => b.id);
  const taskIds = (await db.task.findMany({ where: { listingId: { in: ownListings } }, select: { id: true } })).map((t) => t.id);
  await db.auditLog.deleteMany({ where: { OR: [{ targetId: { in: [...bookingIds, ...taskIds, ...createdUsers] } }, { organizationId: otherOrg }] } });
  // Sync records go with their users (cascade); tasks with the bookings and listings.
  await db.booking.deleteMany({ where: { listingId: { in: ownListings } } });
  await db.listing.deleteMany({ where: { id: { in: ownListings } } });
  await db.checklistTemplate.deleteMany({ where: { organizationId: otherOrg } });
  await db.user.deleteMany({ where: { OR: [{ organizationId: otherOrg }, { id: { in: createdUsers } }] } });
  await db.organization.delete({ where: { id: otherOrg } });
  setFileStorage(undefined);
  await rm(storeDir, { recursive: true, force: true });
});

describe("GET /api/admin/journee", () => {
  it("answers the caller's own tasks of today and tomorrow, with check-lists, no amounts, never cached", async () => {
    const res = await dayApi(new Request(`${ORIGIN}/api/admin/journee`, { headers: agent.headers }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.user).toEqual({ id: agent.id, name: agent.actor.user.name });
    expect(body.days).toHaveLength(2);
    expect(body.days[0]).toBe(body.today);
    // A fresh agent has no task today; the seeded agents' tasks never leak to them.
    expect(body.tasks).toEqual([]);
    expect(JSON.stringify(body)).not.toMatch(/Cents|price|amount/i);
  });

  it("refuses anonymous visitors (401), guests and owners (403), staff without 2FA (403)", async () => {
    const call = (headers: Headers) => dayApi(new Request(`${ORIGIN}/api/admin/journee`, { headers }));
    expect((await call(new Headers())).status).toBe(401);
    for (const role of ["GUEST", "OWNER"] as const) expect((await call((await member(role, role === "GUEST" ? null : sigma, false)).headers)).status).toBe(403);
    const r = await call((await member("AGENT", sigma, false)).headers);
    expect(r.status).toBe(403);
    expect((await r.json()).error.code).toBe("TWO_FACTOR_REQUIRED");
  });
});

describe("POST /api/admin/journee/operations", () => {
  it("a day done offline, sent in order: started, ticked, photographed, remarked, finished — audited as offline", async () => {
    const t = await cleaningFor(admin, home, 320, agent.id);
    const required = t.items.filter((i) => i.requiresPhoto);
    const at = new Date(Date.now() - 3_600_000).toISOString();
    expect(await result(agent.headers, { opId: opId(), taskId: t.id, kind: "start", at })).toMatchObject({ outcome: "APPLIED", replayed: false });
    for (const i of t.items) expect((await result(agent.headers, { opId: opId(), taskId: t.id, kind: "check", itemId: i.id, checked: true, at })).outcome).toBe("APPLIED");
    for (const i of required) expect((await result(agent.headers, { opId: opId(), taskId: t.id, kind: "photo", itemId: i.id, at }, PNG)).outcome).toBe("APPLIED");
    expect((await result(agent.headers, { opId: opId(), taskId: t.id, kind: "note", notes: "Une ampoule grillée dans la chambre", at })).outcome).toBe("APPLIED");
    expect((await result(agent.headers, { opId: opId(), taskId: t.id, kind: "complete", at })).outcome).toBe("APPLIED");

    const done = await db.task.findUniqueOrThrow({ where: { id: t.id }, include: { photos: true, items: true } });
    expect(done).toMatchObject({ status: "DONE", fieldNotes: "Une ampoule grillée dans la chambre" });
    expect(done.photos).toHaveLength(required.length);
    expect(done.items.every((i) => i.checkedAt && i.checkedById === agent.id)).toBe(true);
    const audit = await db.auditLog.findMany({ where: { targetId: t.id, action: "task.status_changed" }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => a.details)).toEqual([
      { type: "CLEANING", from: "TODO", to: "IN_PROGRESS", offline: true },
      { type: "CLEANING", from: "IN_PROGRESS", to: "DONE", offline: true },
    ]);
    const recorded = await db.taskSyncOperation.findMany({ where: { userId: agent.id, taskId: t.id } });
    expect(recorded.every((r) => r.outcome === "APPLIED" && r.organizationId === sigma && r.clientAt?.toISOString() === at)).toBe(true);
    // The day as the phone gets it reflects all of it.
    const body = await (await dayApi(new Request(`${ORIGIN}/api/admin/journee`, { headers: agent.headers }))).json();
    expect(body.tasks).toEqual([]); // day 320 isn't today: the API only sends today and tomorrow
  });

  it("is idempotent: the same operation sent again is answered from the record and changes nothing", async () => {
    const t = await cleaningFor(admin, home, 324, agent.id);
    const start = { opId: opId(), taskId: t.id, kind: "start" };
    expect(await result(agent.headers, start)).toMatchObject({ outcome: "APPLIED", replayed: false });
    expect(await result(agent.headers, start)).toMatchObject({ outcome: "APPLIED", replayed: true });
    const item = t.items.find((i) => i.requiresPhoto)!;
    const photo = { opId: opId(), taskId: t.id, kind: "photo", itemId: item.id };
    expect(await result(agent.headers, photo, PNG)).toMatchObject({ outcome: "APPLIED", replayed: false });
    expect(await result(agent.headers, photo, PNG)).toMatchObject({ outcome: "APPLIED", replayed: true });
    expect(await db.taskPhoto.count({ where: { taskId: t.id } })).toBe(1);
    // Concurrent copies (a retry racing the first attempt): one photo, one answer each.
    const racing = { opId: opId(), taskId: t.id, kind: "photo", itemId: item.id };
    const both = await Promise.all([result(agent.headers, racing, PNG), result(agent.headers, racing, PNG)]);
    expect(both.map((r) => r.outcome)).toEqual(["APPLIED", "APPLIED"]);
    expect(both.filter((r) => r.replayed)).toHaveLength(1);
    expect(await db.taskPhoto.count({ where: { taskId: t.id } })).toBe(2);
    expect(await db.auditLog.count({ where: { targetId: t.id, action: "task.status_changed" } })).toBe(1);
    // Only one record per operation id, and the files of refused copies are not left behind.
    expect(await db.taskSyncOperation.count({ where: { userId: agent.id, opId: racing.opId } })).toBe(1);
    expect(await readdir(join(storeDir, "tasks", sigma, t.id))).toHaveLength(2);
    // The same id from another agent is another operation (ids are per person), refused here since the task isn't theirs.
    expect(await result(agent2.headers, start)).toMatchObject({ outcome: "REJECTED", code: "TASK_GONE", replayed: false });
  });

  it("the intent already met is fine: starting a task in progress, finishing a task done", async () => {
    const t = await cleaningFor(admin, home, 328, agent.id);
    await db.task.update({ where: { id: t.id }, data: { status: "IN_PROGRESS", startedAt: new Date() } });
    expect(await result(agent.headers, { opId: opId(), taskId: t.id, kind: "start" })).toMatchObject({ outcome: "APPLIED" });
    // Incomplete: refused with what is missing, and the record keeps the answer.
    const finish = { opId: opId(), taskId: t.id, kind: "complete" };
    const r = await result(agent.headers, finish);
    expect(r).toMatchObject({ outcome: "REJECTED", code: "TASK_INCOMPLETE" });
    expect(r.message).toMatch(/^La tâche n'a pas pu être terminée\. Il reste à cocher : /);
    await db.taskChecklistItem.updateMany({ where: { taskId: t.id }, data: { checkedAt: new Date() } });
    await db.task.update({ where: { id: t.id }, data: { status: "DONE", completedAt: new Date() } });
    expect(await result(agent.headers, { opId: opId(), taskId: t.id, kind: "complete" })).toMatchObject({ outcome: "APPLIED", replayed: false });
    expect(await result(agent.headers, finish)).toMatchObject({ outcome: "REJECTED", code: "TASK_INCOMPLETE", replayed: true });
  });

  it("conflict: a task reassigned while the agent was offline refuses their changes (server wins), and keeps refusing them", async () => {
    const t = await cleaningFor(admin, home, 332, agent.id);
    expect((await result(agent.headers, { opId: opId(), taskId: t.id, kind: "start" })).outcome).toBe("APPLIED");
    // Meanwhile, an associé gives it to agent2.
    await db.task.update({ where: { id: t.id }, data: { assigneeId: agent2.id } });
    const tick = { opId: opId(), taskId: t.id, kind: "check", itemId: t.items[0].id, checked: true };
    const r = await result(agent.headers, tick);
    expect(r).toEqual({ opId: tick.opId, outcome: "REJECTED", code: "TASK_GONE", message: "Cette tâche ne vous est plus confiée (réaffectée ou retirée) : ce changement n'a pas été enregistré.", replayed: false });
    const photo = await result(agent.headers, { opId: opId(), taskId: t.id, kind: "photo", itemId: t.items[0].id }, PNG);
    expect(photo).toMatchObject({ outcome: "REJECTED", code: "TASK_GONE" });
    expect(await db.taskChecklistItem.count({ where: { taskId: t.id, checkedAt: { not: null } } })).toBe(0);
    expect(await db.taskPhoto.count({ where: { taskId: t.id } })).toBe(0);
    // Given back to the agent: the old operation's answer doesn't change (it was decided), a new one goes through.
    await db.task.update({ where: { id: t.id }, data: { assigneeId: agent.id } });
    expect(await result(agent.headers, tick)).toMatchObject({ outcome: "REJECTED", code: "TASK_GONE", replayed: true });
    expect(await result(agent.headers, { ...tick, opId: opId() })).toMatchObject({ outcome: "APPLIED" });
  });

  it("conflict: a task cancelled meanwhile refuses everything, a remark included", async () => {
    const t = await cleaningFor(admin, home, 336, agent.id);
    await db.task.update({ where: { id: t.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    for (const op of [
      { kind: "start" },
      { kind: "check", itemId: t.items[0].id, checked: true },
      { kind: "note", notes: "x" },
      { kind: "complete" },
    ]) {
      expect(await result(agent.headers, { opId: opId(), taskId: t.id, ...op }), op.kind).toMatchObject({ outcome: "REJECTED", code: "TASK_CANCELLED", message: expect.stringContaining("annulée") });
    }
    expect((await db.task.findUniqueOrThrow({ where: { id: t.id } })).fieldNotes).toBeNull();
  });

  it("refuses a colleague's task, an unassigned one, another organization's — even to an associé, it is not their day", async () => {
    const mine = await cleaningFor(admin, home, 340, agent.id);
    const theirs = await cleaningFor(otherAdmin, otherListing, 340, otherAdmin.id);
    for (const [who, taskId] of [
      [agent2, mine.id],
      [admin, mine.id],
      [agent, theirs.id],
      [otherAdmin, mine.id],
      [agent, "unknown-task"],
    ] as const) {
      expect(await result(who.headers, { opId: opId(), taskId, kind: "start" })).toMatchObject({ outcome: "REJECTED", code: "TASK_GONE" });
    }
    expect((await db.task.findUniqueOrThrow({ where: { id: mine.id } })).status).toBe("TODO");
    expect((await db.task.findUniqueOrThrow({ where: { id: theirs.id } })).status).toBe("TODO");
  });

  it("refuses anonymous, guests, owners, staff without 2FA, another site's Origin and unreadable operations", async () => {
    const t = await cleaningFor(admin, home, 344, agent.id);
    const op = { opId: opId(), taskId: t.id, kind: "start" };
    expect((await send(new Headers({ origin: ORIGIN }), op)).status).toBe(401);
    for (const role of ["GUEST", "OWNER"] as const) expect((await send((await member(role, role === "GUEST" ? null : sigma, false)).headers, op)).status).toBe(403);
    expect((await send((await member("ADMIN", sigma, false)).headers, op)).body.error?.code).toBe("TWO_FACTOR_REQUIRED");
    expect((await send(agent.headers, op, undefined, { origin: "https://evil.example" })).body.error?.code).toBe("BAD_ORIGIN");
    for (const bad of [{ ...op, kind: "delete" }, { ...op, opId: "x" }, { ...op, kind: "check" }, { ...op, kind: "note", notes: "a\u0000b" }]) {
      expect((await send(agent.headers, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    // A photo operation without a valid image is refused (and recorded); no file is kept.
    await result(agent.headers, op);
    const noImage = await result(agent.headers, { opId: opId(), taskId: t.id, kind: "photo", itemId: t.items[0].id }, new TextEncoder().encode("pas une image"));
    expect(noImage).toMatchObject({ outcome: "REJECTED", code: "INVALID_PHOTO" });
    expect(await db.taskPhoto.count({ where: { taskId: t.id } })).toBe(0);
    expect((await db.task.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("IN_PROGRESS");
  });
});
