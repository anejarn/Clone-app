import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/generated/prisma/enums";

/**
 * Pannes (Lot 3b) through the real server actions and functions: reporting (on a home, from a task, with a photo),
 * who sees what (associés everything, agents what they reported or are assigned), the thread, status rules, assignment,
 * priority, cost (associés only, never shown to agents), refusals, isolation between organizations, photos in /media,
 * the dashboard. Every row is on homes this file creates, deleted at the end with the other organization.
 */
const ctx = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({
  headers: async () => ctx.headers,
  cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/cache")>()), updateTag: vi.fn(), refresh: vi.fn() }));

const act = await import("@/app/admin/pannes/actions");
const { GET: media } = await import("@/app/media/[...key]/route");
const { createStaffEntry } = await import("@/lib/server/admin/bookings");
const { parseEntryForm } = await import("@/lib/admin/booking-form");
const { dashboardCounts } = await import("@/lib/server/admin/dashboard");
const { getTicket, listTickets, urgentTickets } = await import("@/lib/server/operations/tickets");
const { db } = await import("@/lib/server/db");
const { LocalStorage } = await import("@/lib/storage/local");
const { setFileStorage } = await import("@/lib/storage");
const { day, sigmaOrgId } = await import("./helpers");
const { signedInMember } = await import("./staff");

type Authorized = import("@/lib/server/authz").Authorized;

const sigma = await sigmaOrgId();
const TOKEN = `K${Date.now()}`;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

let storeDir: string;
let admin: Member;
let agent: Member;
let agent2: Member;
let otherAdmin: Member;
let otherAgent: Member;
let ownerId: string;
let otherOrg: string;
let home: string;
let riad: string;
let otherListing: string;
const refused = new Map<string, Headers>();
const createdUsers: string[] = [];
const ownListings: string[] = [];

interface Member {
  headers: Headers;
  actor: Authorized;
  id: string;
}

const as = (h: Headers) => {
  ctx.headers = h;
};

function form(values: Record<string, string>, photo?: Uint8Array) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.append(k, v);
  if (photo) f.set("photo", new File([photo as Uint8Array<ArrayBuffer>], "photo.png", { type: "image/png" }));
  return f;
}
const mediaGet = (url: string, headers = new Headers()) =>
  media(new Request(`http://localhost:3100${url}`, { headers }), { params: Promise.resolve({ key: url.replace(/^\/media\//, "").split("/") }) });

async function member(role: Role, organizationId: string | null, twoFactor = true): Promise<Member> {
  const m = await signedInMember({ role, organizationId, twoFactor, name: `${role} ${TOKEN}` });
  createdUsers.push(m.user.id);
  const actor: Authorized = { user: { id: m.user.id, name: m.user.name, email: m.user.email, role, twoFactorEnabled: twoFactor }, organizationId: organizationId ?? "" };
  return { headers: m.headers, actor, id: m.user.id };
}

async function makeHome(organizationId: string, owner: string, title: string) {
  const place = await db.place.findFirstOrThrow({ where: { slug: "gueliz" } });
  const l = await db.listing.create({
    data: { title: `${title} ${TOKEN}`, description: "x", organizationId, placeId: place.id, ownerId: owner, address: `Rue ${TOKEN}`, lat: 31.63, lng: -8.0, maxGuests: 4, minNights: 1, priceCents: 80_000 },
  });
  ownListings.push(l.id);
  return l.id;
}

/** Reports a ticket through the action; returns its id (the action redirects on success). */
async function report(values: Record<string, string>, photo?: Uint8Array): Promise<{ id?: string; state?: import("@/app/admin/pannes/actions").TicketActionState }> {
  try {
    return { state: await act.createTicketAction({}, form(values, photo)) };
  } catch (e) {
    const id = /\/admin\/pannes\/([^?;]+)\?cree=1/.exec(String((e as { digest?: string }).digest ?? ""))?.[1];
    if (!id) throw e;
    return { id };
  }
}
const leak = (values: Record<string, string>) => ({ listingId: home, title: `Fuite ${TOKEN}`, description: "Sous l'évier de la cuisine", category: "PLUMBING", priority: "HIGH", ...values });

beforeAll(async () => {
  storeDir = await mkdtemp(join(tmpdir(), "sigma-tickets-"));
  setFileStorage(new LocalStorage(storeDir));
  const owner = await db.user.create({ data: { name: `Owner ${TOKEN}`, email: `owner-${TOKEN.toLowerCase()}@test.sigma.test`, role: "OWNER", organizationId: sigma } });
  ownerId = owner.id;
  createdUsers.push(owner.id);
  home = await makeHome(sigma, owner.id, "Appartement pannes");
  riad = await makeHome(sigma, owner.id, "Riad pannes");
  admin = await member("ADMIN", sigma);
  agent = await member("AGENT", sigma);
  agent2 = await member("AGENT", sigma);

  otherOrg = (await db.organization.create({ data: { name: "Autre conciergerie", slug: `tk-${TOKEN.toLowerCase()}` } })).id;
  const otherOwner = await db.user.create({ data: { name: "Owner other", email: `owner-other-${TOKEN.toLowerCase()}@test.sigma.test`, role: "OWNER", organizationId: otherOrg } });
  otherListing = await makeHome(otherOrg, otherOwner.id, "Autre bien");
  otherAdmin = await member("ADMIN", otherOrg);
  otherAgent = await member("AGENT", otherOrg);

  refused.set("anonymous", new Headers());
  refused.set("guest", (await member("GUEST", null, false)).headers);
  refused.set("owner", (await member("OWNER", sigma, false)).headers);
  refused.set("admin without 2FA", (await member("ADMIN", sigma, false)).headers);
});

beforeEach(() => as(admin.headers));

afterAll(async () => {
  const ticketIds = (await db.ticket.findMany({ where: { listingId: { in: ownListings } }, select: { id: true } })).map((t) => t.id);
  const bookingIds = (await db.booking.findMany({ where: { listingId: { in: ownListings } }, select: { id: true } })).map((b) => b.id);
  const taskIds = (await db.task.findMany({ where: { listingId: { in: ownListings } }, select: { id: true } })).map((t) => t.id);
  await db.auditLog.deleteMany({ where: { OR: [{ targetId: { in: [...ticketIds, ...bookingIds, ...taskIds, ...createdUsers] } }, { organizationId: otherOrg }] } });
  // Tickets, their thread and photos go with the listings (cascade), tasks with the bookings.
  await db.ticket.deleteMany({ where: { listingId: { in: ownListings } } });
  await db.booking.deleteMany({ where: { listingId: { in: ownListings } } });
  await db.listing.deleteMany({ where: { id: { in: ownListings } } });
  await db.checklistTemplate.deleteMany({ where: { organizationId: otherOrg } });
  await db.user.deleteMany({ where: { OR: [{ organizationId: otherOrg }, { id: { in: createdUsers } }] } });
  await db.organization.delete({ where: { id: otherOrg } });
  setFileStorage(undefined);
  await rm(storeDir, { recursive: true, force: true });
});

describe("reporting", () => {
  it("an agent reports a breakdown on a home with a photo: reporter, thread, audit trail", async () => {
    as(agent.headers);
    const { id } = await report(leak({}), PNG);
    expect(id).toBeDefined();
    const t = await db.ticket.findUniqueOrThrow({ where: { id: id! }, include: { photos: true, events: { orderBy: { createdAt: "asc" } } } });
    expect(t).toMatchObject({ organizationId: sigma, listingId: home, reporterId: agent.id, assigneeId: null, status: "OPEN", priority: "HIGH", category: "PLUMBING", bookingId: null, taskId: null });
    expect(t.title).toBe(`Fuite ${TOKEN}`);
    expect(t.photos).toHaveLength(1);
    expect(t.photos[0].storageKey.startsWith(`tickets/${sigma}/${id}/`)).toBe(true);
    expect(t.events.map((e) => e.kind)).toEqual(["CREATED", "PHOTO"]);
    expect(await db.auditLog.findFirst({ where: { targetId: id!, action: "ticket.created" } })).toMatchObject({ actorId: agent.id, targetType: "ticket", organizationId: sigma });
    const seen = await getTicket(agent.actor, id!);
    expect(seen?.reporter?.id).toBe(agent.id);
    expect(seen?.cost).toBeNull();
  });

  it("from a task: its home and stay are used; an agent only from their own tasks", async () => {
    const entry = parseEntryForm("directe", { listingId: riad, checkIn: day(300), checkOut: day(302), adults: "2", children: "0", note: "", guestName: "Hind", guestPhone: "+212 6 00 00 00 00", channel: "PHONE", nightly: "", cleaning: "" });
    if (!entry.ok) throw new Error("entry");
    const booking = await createStaffEntry(admin.actor, entry.entry);
    const cleaning = await db.task.findFirstOrThrow({ where: { bookingId: booking.id, type: "CLEANING" } });
    await db.task.update({ where: { id: cleaning.id }, data: { assigneeId: agent.id } });

    as(agent2.headers);
    expect((await report({ taskId: cleaning.id, title: "Clim", category: "AIR_CONDITIONING" })).state).toMatchObject({ error: "Tâche introuvable." });
    as(agent.headers);
    const { id } = await report({ taskId: cleaning.id, listingId: home, title: "Clim qui ne refroidit plus", category: "AIR_CONDITIONING", priority: "URGENT" });
    // The task's home wins over a listing sent along.
    expect(await db.ticket.findUniqueOrThrow({ where: { id: id! } })).toMatchObject({ listingId: riad, taskId: cleaning.id, bookingId: booking.id, priority: "URGENT" });
  });

  it("refuses another organization's home, an invalid form, a file that isn't an image", async () => {
    as(agent.headers);
    expect((await report(leak({ listingId: otherListing }))).state).toMatchObject({ error: "Bien introuvable." });
    expect((await report(leak({ title: "" }))).state).toMatchObject({ error: "Corrigez les champs signalés.", fieldErrors: { title: expect.any(String) } });
    expect((await report(leak({}), new TextEncoder().encode("pas une image"))).state).toMatchObject({ error: "Format non accepté : JPEG, PNG ou WebP uniquement." });
    expect(await db.ticket.count({ where: { listingId: otherListing } })).toBe(0);
  });

  it("the database refuses a stay of another home, and status dates that don't match the status", async () => {
    const other = await db.booking.findFirstOrThrow({ where: { organizationId: sigma, listingId: { notIn: [home] } } });
    await expect(db.ticket.create({ data: { organizationId: sigma, listingId: home, bookingId: other.id, title: "x", category: "OTHER" } })).rejects.toThrow(/tickets_check/);
    await expect(db.ticket.create({ data: { organizationId: sigma, listingId: home, title: "x", category: "OTHER", status: "RESOLVED" } })).rejects.toThrow(/tickets_status_check/);
    await expect(db.ticket.create({ data: { organizationId: sigma, listingId: home, title: "x", category: "OTHER", assigneeId: ownerId } })).rejects.toThrow(/tickets_check/);
    await expect(db.ticket.create({ data: { organizationId: sigma, listingId: home, title: "x", category: "OTHER", rechargeOwner: true } })).rejects.toThrow(/tickets_cost_check/);
  });
});

describe("who sees what, and who changes what", () => {
  it("agents see what they reported or are assigned; associés see everything", async () => {
    as(agent.headers);
    const { id } = await report(leak({ title: `Serrure ${TOKEN}`, category: "LOCK" }));
    expect(await getTicket(agent2.actor, id!)).toBeNull();
    expect((await listTickets(agent2.actor, { status: "ALL" })).items.map((t) => t.id)).not.toContain(id);
    expect((await listTickets(admin.actor, { status: "ALL", listingId: home })).items.map((t) => t.id)).toContain(id);
    as(agent2.headers);
    expect(await act.commentTicketAction(id!, {}, form({ body: "Je regarde" }))).toEqual({ error: "Panne introuvable." });
    expect(await act.addTicketPhotoAction(id!, form({}, PNG))).toEqual({ error: "Panne introuvable." });

    // Assigned to agent2: now theirs too.
    as(admin.headers);
    expect(await act.assignTicketAction(id!, {}, form({ assigneeId: agent2.id }))).toEqual({ message: "Panne affectée." });
    expect((await getTicket(agent2.actor, id!))?.assignee?.id).toBe(agent2.id);
    expect((await listTickets(agent2.actor)).items.map((t) => t.id)).toContain(id);
    expect(await db.auditLog.count({ where: { targetId: id!, action: "ticket.assigned" } })).toBe(1);
  });

  it("the assigned agent moves it along; the reporter comments; only associés cancel, reopen, assign, set priority and cost", async () => {
    as(agent.headers);
    const { id } = await report(leak({ title: `Chauffe-eau ${TOKEN}`, category: "APPLIANCE" }));
    // The reporter (not assigned) can't change the status.
    expect(await act.setTicketStatusAction(id!, {}, form({ status: "RESOLVED" }))).toEqual({ error: "Vous ne pouvez pas mettre cette panne dans ce statut." });
    expect(await act.commentTicketAction(id!, {}, form({ body: "Le voyant clignote en rouge." }))).toEqual({ message: "Commentaire ajouté." });
    expect(await act.commentTicketAction(id!, {}, form({ body: "   " }))).toEqual({ error: "Commentaire : écrivez quelque chose." });

    as(admin.headers);
    await act.assignTicketAction(id!, {}, form({ assigneeId: agent.id }));
    as(agent.headers);
    expect(await act.setTicketStatusAction(id!, {}, form({ status: "WAITING", waitingFor: "" }))).toMatchObject({ error: "Corrigez les champs signalés." });
    expect(await act.setTicketStatusAction(id!, {}, form({ status: "WAITING", waitingFor: "PART", note: "Résistance commandée" }))).toEqual({ message: "Statut enregistré." });
    expect(await act.setTicketStatusAction(id!, {}, form({ status: "CANCELLED" }))).toEqual({ error: "Vous ne pouvez pas mettre cette panne dans ce statut." });
    for (const r of [
      await act.assignTicketAction(id!, {}, form({ assigneeId: agent2.id })),
      await act.setTicketPriorityAction(id!, {}, form({ priority: "LOW" })),
      await act.setTicketCostAction(id!, {}, form({ cost: "10" })),
    ]) {
      expect(r).toEqual({ error: "Réservé aux associés." });
    }
    expect(await act.setTicketStatusAction(id!, {}, form({ status: "RESOLVED" }))).toEqual({ message: "Statut enregistré." });
    let t = await db.ticket.findUniqueOrThrow({ where: { id: id! } });
    expect(t).toMatchObject({ status: "RESOLVED", waitingFor: null, assigneeId: agent.id, priority: "HIGH", costCents: null });
    expect(t.resolvedAt).not.toBeNull();
    // Resolved: the agent can't reopen it.
    expect(await act.setTicketStatusAction(id!, {}, form({ status: "OPEN" }))).toEqual({ error: "Vous ne pouvez pas mettre cette panne dans ce statut." });

    as(admin.headers);
    expect(await act.setTicketCostAction(id!, {}, form({ cost: "1 250,50", rechargeOwner: "on" }))).toEqual({ message: "Coût enregistré." });
    expect(await act.setTicketCostAction(id!, {}, form({ cost: "", rechargeOwner: "on" }))).toMatchObject({ error: "Corrigez les champs signalés." });
    expect(await act.setTicketPriorityAction(id!, {}, form({ priority: "URGENT" }))).toEqual({ message: "Priorité enregistrée." });
    expect(await act.setTicketStatusAction(id!, {}, form({ status: "OPEN", note: "Fuite revenue" }))).toEqual({ message: "Statut enregistré." });
    t = await db.ticket.findUniqueOrThrow({ where: { id: id! } });
    expect(t).toMatchObject({ status: "OPEN", resolvedAt: null, costCents: 125_050, rechargeOwner: true, priority: "URGENT" });

    // The thread, in order; the agent never reads the cost, not even in the thread.
    const full = await getTicket(admin.actor, id!);
    expect(full?.events.map((e) => e.kind)).toEqual(["CREATED", "COMMENT", "ASSIGNED", "STATUS", "STATUS", "COST", "PRIORITY", "STATUS"]);
    expect(full?.cost).toEqual({ cents: 125_050, rechargeOwner: true });
    const agentView = await getTicket(agent.actor, id!);
    expect(agentView?.cost).toBeNull();
    expect(agentView?.events.map((e) => e.kind)).not.toContain("COST");
    expect(JSON.stringify(agentView)).not.toContain("125050");
    const audits = await db.auditLog.findMany({ where: { targetId: id! }, orderBy: { createdAt: "asc" } });
    expect(audits.map((a) => a.action)).toEqual([
      "ticket.created",
      "ticket.assigned",
      "ticket.status_changed",
      "ticket.status_changed",
      "ticket.cost_changed",
      "ticket.priority_changed",
      "ticket.status_changed",
    ]);
  });

  it("assigns only to an active associé or agent of the organization", async () => {
    const { id } = await report(leak({ title: `Prise ${TOKEN}`, category: "ELECTRICITY" }));
    const refusal = { error: "Choisissez un membre actif de l'équipe (associé ou agent)." };
    for (const who of [ownerId, otherAgent.id, otherAdmin.id, "inconnu"]) expect(await act.assignTicketAction(id!, {}, form({ assigneeId: who })), who).toEqual(refusal);
  });

  it("filters: open ones by default, by priority, category and assignee; most urgent first", async () => {
    const { id: low } = await report(leak({ listingId: riad, title: `Ampoule ${TOKEN}`, category: "ELECTRICITY", priority: "LOW" }));
    const { id: urgent } = await report(leak({ listingId: riad, title: `Porte bloquée ${TOKEN}`, category: "LOCK", priority: "URGENT" }));
    const mine = (await listTickets(admin.actor, { listingId: riad })).items.filter((t) => [low, urgent].includes(t.id)).map((t) => t.id);
    expect(mine).toEqual([urgent, low]);
    expect((await listTickets(admin.actor, { listingId: riad, priority: "LOW" })).items.map((t) => t.id)).toEqual([low]);
    expect((await listTickets(admin.actor, { listingId: riad, category: "LOCK", assignee: "none" })).items.map((t) => t.id)).toEqual([urgent]);
    await act.setTicketStatusAction(low!, {}, form({ status: "CANCELLED" }));
    expect((await listTickets(admin.actor, { listingId: riad })).items.map((t) => t.id)).not.toContain(low);
    expect((await listTickets(admin.actor, { listingId: riad, status: "CANCELLED" })).items.map((t) => t.id)).toEqual([low]);
    // A cancelled ticket takes no more photos.
    expect(await act.addTicketPhotoAction(low!, form({}, PNG))).toEqual({ error: "Cette panne est annulée." });
  });

  it("urgent open tickets surface on the dashboard", async () => {
    const before = await dashboardCounts(sigma);
    const { id } = await report(leak({ title: `Coupure générale ${TOKEN}`, category: "ELECTRICITY", priority: "URGENT" }));
    const after = await dashboardCounts(sigma);
    expect(after.ticketsUrgent - before.ticketsUrgent).toBe(1);
    expect(after.ticketsOpen - before.ticketsOpen).toBe(1);
    expect((await urgentTickets(admin.actor, 100)).map((t) => t.id)).toContain(id);
    expect((await urgentTickets(agent2.actor, 100)).map((t) => t.id)).not.toContain(id);
    await act.setTicketStatusAction(id!, {}, form({ status: "RESOLVED" }));
    expect((await dashboardCounts(sigma)).ticketsUrgent).toBe(before.ticketsUrgent);
    expect(await dashboardCounts(otherOrg)).toMatchObject({ ticketsOpen: 0, ticketsUrgent: 0 });
  });
});

describe("access", () => {
  it("anonymous visitors, guests, owners and admins without 2FA are refused by every action, and nothing changes", async () => {
    const { id } = await report(leak({ title: `Volet ${TOKEN}`, category: "OTHER" }));
    const before = JSON.stringify(await db.ticket.findUniqueOrThrow({ where: { id: id! }, include: { events: true, photos: true } }));
    const expected: Record<string, string> = {
      anonymous: "Connectez-vous pour continuer.",
      guest: "Accès refusé.",
      owner: "Accès refusé.",
      "admin without 2FA": "Activez la double authentification pour accéder à l'espace équipe.",
    };
    for (const [name, headers] of refused) {
      as(headers);
      const want = { error: expected[name] };
      expect((await report(leak({}))).state, name).toEqual(want);
      expect(await act.commentTicketAction(id!, {}, form({ body: "x" })), name).toEqual(want);
      expect(await act.setTicketStatusAction(id!, {}, form({ status: "RESOLVED" })), name).toEqual(want);
      expect(await act.assignTicketAction(id!, {}, form({ assigneeId: admin.id })), name).toEqual(want);
      expect(await act.setTicketPriorityAction(id!, {}, form({ priority: "LOW" })), name).toEqual(want);
      expect(await act.setTicketCostAction(id!, {}, form({ cost: "1" })), name).toEqual(want);
      expect(await act.addTicketPhotoAction(id!, form({}, PNG)), name).toEqual(want);
    }
    expect(JSON.stringify(await db.ticket.findUniqueOrThrow({ where: { id: id! }, include: { events: true, photos: true } }))).toBe(before);
  });

  it("another organization gets 404 for every ticket of Sigma, and Sigma for theirs", async () => {
    const { id } = await report(leak({ title: `Fenêtre ${TOKEN}`, category: "OTHER" }));
    expect(await getTicket(otherAdmin.actor, id!)).toBeNull();
    expect((await listTickets(otherAdmin.actor, { status: "ALL" })).items).toEqual([]);
    as(otherAdmin.headers);
    for (const r of [
      await act.commentTicketAction(id!, {}, form({ body: "x" })),
      await act.setTicketStatusAction(id!, {}, form({ status: "CANCELLED" })),
      await act.assignTicketAction(id!, {}, form({ assigneeId: otherAgent.id })),
      await act.setTicketPriorityAction(id!, {}, form({ priority: "LOW" })),
      await act.setTicketCostAction(id!, {}, form({ cost: "1" })),
      await act.addTicketPhotoAction(id!, form({}, PNG)),
    ]) {
      expect(r).toEqual({ error: "Panne introuvable." });
    }
    const theirs = await report({ listingId: otherListing, title: "Leur panne", category: "OTHER" });
    expect(theirs.id).toBeDefined();
    expect(await getTicket(admin.actor, theirs.id!)).toBeNull();
    as(admin.headers);
    expect(await act.commentTicketAction(theirs.id!, {}, form({ body: "x" }))).toEqual({ error: "Panne introuvable." });
  });

  it("ticket photos are served to the associés and to the agents who reported or are assigned the ticket only, never cached", async () => {
    as(agent.headers);
    const { id } = await report(leak({ title: `Robinet ${TOKEN}`, category: "PLUMBING" }), PNG);
    const { url } = await db.ticketPhoto.findFirstOrThrow({ where: { ticketId: id! } });
    for (const [name, headers] of [...refused, ["other organization", otherAdmin.headers] as const, ["other organization's agent", otherAgent.headers] as const, ["unrelated agent", agent2.headers] as const]) {
      expect((await mediaGet(url, headers)).status, name).toBe(404);
    }
    for (const headers of [admin.headers, agent.headers]) {
      const r = await mediaGet(url, headers);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toBe("image/png");
      expect(r.headers.get("cache-control")).toBe("private, no-store");
    }
    // Once assigned, agent2 may see it too.
    as(admin.headers);
    await act.assignTicketAction(id!, {}, form({ assigneeId: agent2.id }));
    expect((await mediaGet(url, agent2.headers)).status).toBe(200);
    expect((await mediaGet(`/media/tickets/${sigma}/${id}/unknown.png`, admin.headers)).status).toBe(404);
  });
});
