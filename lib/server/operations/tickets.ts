import "server-only";
import { randomBytes } from "node:crypto";
import type { CostInput, NewTicketInput, StatusInput } from "@/lib/admin/ticket-form";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { TicketCategory, TicketPriority, TicketStatus, TicketWaitingFor, TaskType, TicketEventKind } from "@/lib/generated/prisma/enums";
import { TASK_TYPE_TITLE } from "@/lib/operations/labels";
import { allowedStatusChanges, canSeeTicket, checkStatusChange, managesTickets, OPEN_TICKET_STATUSES, statusFields, TICKET_STATUS_LABEL } from "@/lib/operations/tickets";
import { canSeeAllTasks } from "@/lib/admin/sections";
import { fileStorage } from "@/lib/storage";
import { checkPhoto, IMAGE_EXTENSION } from "@/lib/storage/images";
import { recordAudit } from "../audit";
import type { Authorized } from "../authz";
import { db } from "../db";
import { AppError } from "../errors";

/**
 * Breakdown reports (Pannes): a ticket on a home, with its thread (comments and changes) and photos, followed until
 * it is fixed. Every function takes the caller (lib/server/authz.ts) and only touches their organization's rows;
 * a ticket the caller can't see — another organization's, or for an agent one they neither reported nor are
 * assigned to — is answered 404 like an unknown one. Rules of who changes what: lib/operations/tickets.ts.
 * Creation, status, assignment, priority and cost changes are audited (audit_logs) and written to the thread; comments
 * and photos to the thread only. Amounts (the repair's cost) are for associés only.
 */

const ticketNotFound = () => new AppError(404, "NOT_FOUND", "Panne introuvable.");
export const MAX_TICKET_PHOTOS = 20;
export const TICKET_LIST_LIMIT = 300;

const actorOf = (a: Authorized) => ({ role: a.user.role, userId: a.user.id });

/** Rows the caller may see: every ticket of the organization for an associé, their own for an agent. */
function visibleWhere(actor: Authorized): Prisma.TicketWhereInput {
  return {
    organizationId: actor.organizationId,
    ...(!managesTickets(actor.user.role) && { OR: [{ reporterId: actor.user.id }, { assigneeId: actor.user.id }] }),
  };
}

const listSelect = {
  id: true,
  title: true,
  category: true,
  priority: true,
  status: true,
  waitingFor: true,
  costCents: true,
  rechargeOwner: true,
  createdAt: true,
  updatedAt: true,
  resolvedAt: true,
  reporterId: true,
  assigneeId: true,
  reporter: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true } },
  listing: { select: { id: true, title: true, address: true } },
  task: { select: { id: true, type: true, title: true } },
  bookingId: true,
  _count: { select: { photos: true } },
} satisfies Prisma.TicketSelect;

type ListRow = Prisma.TicketGetPayload<{ select: typeof listSelect }>;

/** A ticket as the team sees it; serializable. `cost` is null for agents (never an amount). */
export interface TicketView {
  id: string;
  title: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  waitingFor: TicketWaitingFor | null;
  listing: { id: string; title: string; address: string };
  reporter: { id: string; name: string } | null;
  assignee: { id: string; name: string } | null;
  task: { id: string; title: string; type: TaskType } | null;
  bookingId: string | null;
  photoCount: number;
  cost: { cents: number | null; rechargeOwner: boolean } | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

function toView(actor: Authorized, t: ListRow): TicketView {
  return {
    id: t.id,
    title: t.title,
    category: t.category,
    priority: t.priority,
    status: t.status,
    waitingFor: t.waitingFor,
    listing: t.listing,
    reporter: t.reporter,
    assignee: t.assignee,
    task: t.task && { id: t.task.id, type: t.task.type, title: t.task.title ?? TASK_TYPE_TITLE[t.task.type] },
    bookingId: t.bookingId,
    photoCount: t._count.photos,
    cost: managesTickets(actor.user.role) ? { cents: t.costCents, rechargeOwner: t.rechargeOwner } : null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    resolvedAt: t.resolvedAt?.toISOString() ?? null,
  };
}

// ---------- Reading ----------

export interface TicketFilters {
  /** "OPEN_ANY" (default: signalée, en cours, en attente), "ALL", or one status. */
  status?: TicketStatus | "OPEN_ANY" | "ALL";
  priority?: TicketPriority;
  category?: TicketCategory;
  listingId?: string;
  /** A member's id, or "none" for unassigned tickets. */
  assignee?: string;
}

/** The tickets the caller can see, most urgent first, then the most recent. */
export async function listTickets(actor: Authorized, f: TicketFilters = {}): Promise<{ items: TicketView[]; truncated: boolean }> {
  const status = f.status ?? "OPEN_ANY";
  const rows = await db.ticket.findMany({
    where: {
      AND: [
        visibleWhere(actor),
        status === "ALL" ? {} : status === "OPEN_ANY" ? { status: { in: [...OPEN_TICKET_STATUSES] } } : { status },
        f.priority ? { priority: f.priority } : {},
        f.category ? { category: f.category } : {},
        f.listingId ? { listingId: f.listingId } : {},
        f.assignee === "none" ? { assigneeId: null } : f.assignee ? { assigneeId: f.assignee } : {},
      ],
    },
    select: listSelect,
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }, { id: "asc" }],
    take: TICKET_LIST_LIMIT + 1,
  });
  return { items: rows.slice(0, TICKET_LIST_LIMIT).map((r) => toView(actor, r)), truncated: rows.length > TICKET_LIST_LIMIT };
}

export interface TicketEventView {
  id: string;
  kind: TicketEventKind;
  author: string | null;
  body: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface TicketDetail extends TicketView {
  description: string;
  photos: { id: string; url: string; createdAt: string }[];
  events: TicketEventView[];
  /** What the caller may do on it. */
  can: { manage: boolean; statuses: TicketStatus[] };
}

/** One ticket with its photos and thread, or null when the caller can't see it. */
export async function getTicket(actor: Authorized, id: string): Promise<TicketDetail | null> {
  const row = await db.ticket.findFirst({
    where: { AND: [{ id }, visibleWhere(actor)] },
    select: {
      ...listSelect,
      description: true,
      photos: { select: { id: true, url: true, createdAt: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      events: {
        select: { id: true, kind: true, body: true, details: true, createdAt: true, author: { select: { name: true } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!row) return null;
  const manage = managesTickets(actor.user.role);
  return {
    ...toView(actor, row),
    description: row.description,
    photos: row.photos.map((p) => ({ id: p.id, url: p.url, createdAt: p.createdAt.toISOString() })),
    // An agent never reads an amount, not even in the thread.
    events: row.events
      .filter((e) => manage || e.kind !== "COST")
      .map((e) => ({
        id: e.id,
        kind: e.kind,
        author: e.author?.name ?? null,
        body: e.body,
        details: (e.details ?? {}) as Record<string, unknown>,
        createdAt: e.createdAt.toISOString(),
      })),
    can: { manage, statuses: allowedStatusChanges(actorOf(actor), row) as TicketStatus[] },
  };
}

/** Open tickets of the organization for the dashboard: how many, how many urgent, and the urgent ones. */
export async function ticketCounts(organizationId: string): Promise<{ ticketsOpen: number; ticketsUrgent: number }> {
  const open = { organizationId, status: { in: [...OPEN_TICKET_STATUSES] } };
  const [ticketsOpen, ticketsUrgent] = await Promise.all([db.ticket.count({ where: open }), db.ticket.count({ where: { ...open, priority: "URGENT" } })]);
  return { ticketsOpen, ticketsUrgent };
}

/** The urgent open tickets the caller can see, oldest first (dashboard). */
export async function urgentTickets(actor: Authorized, take = 10): Promise<TicketView[]> {
  const rows = await db.ticket.findMany({
    where: { AND: [visibleWhere(actor), { status: { in: [...OPEN_TICKET_STATUSES] }, priority: "URGENT" }] },
    select: listSelect,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take,
  });
  return rows.map((r) => toView(actor, r));
}

/** The homes a ticket can be reported on. */
export async function ticketListings(organizationId: string) {
  return db.listing.findMany({ where: { organizationId, category: "HOME" }, select: { id: true, title: true, address: true }, orderBy: [{ title: "asc" }, { id: "asc" }] });
}

/** The task a ticket would be reported from, if the caller may see it (agents: their own tasks). */
export async function ticketSourceTask(actor: Authorized, taskId: string) {
  return db.task.findFirst({
    where: { id: taskId, organizationId: actor.organizationId, ...(!canSeeAllTasks(actor.user.role) && { assigneeId: actor.user.id }) },
    select: { id: true, type: true, title: true, listingId: true, bookingId: true, listing: { select: { title: true } } },
  });
}

// ---------- Writing ----------

interface Locked {
  id: string;
  status: TicketStatus;
  waitingFor: TicketWaitingFor | null;
  priority: TicketPriority;
  reporterId: string | null;
  assigneeId: string | null;
  costCents: number | null;
  rechargeOwner: boolean;
}

/** Holds the ticket's row until the end of the transaction; 404 unless the caller can see it. */
async function lockTicket(tx: Prisma.TransactionClient, actor: Authorized, id: string): Promise<Locked> {
  const rows = await tx.$queryRaw<Locked[]>`
    SELECT "id", "status", "waitingFor", "priority", "reporterId", "assigneeId", "costCents", "rechargeOwner"
    FROM "tickets" WHERE "id" = ${id} AND "organizationId" = ${actor.organizationId} FOR UPDATE`;
  const t = rows[0];
  if (!t || !canSeeTicket(actorOf(actor), t)) throw ticketNotFound();
  return t;
}

function requireManager(actor: Authorized) {
  if (!managesTickets(actor.user.role)) throw new AppError(403, "FORBIDDEN", "Réservé aux associés.");
}

async function event(tx: Prisma.TransactionClient, actor: Authorized, ticketId: string, kind: TicketEventKind, body: string | null, details: Prisma.InputJsonObject = {}) {
  await tx.ticketEvent.create({ data: { organizationId: actor.organizationId, ticketId, authorId: actor.user.id, kind, body, details } });
}

async function assertAssignee(tx: Prisma.TransactionClient, organizationId: string, userId: string) {
  const ok = await tx.user.count({ where: { id: userId, organizationId, role: { in: ["ADMIN", "AGENT"] }, deactivatedAt: null } });
  if (!ok) throw new AppError(422, "INVALID_ASSIGNEE", "Choisissez un membre actif de l'équipe (associé ou agent).");
}

async function storePhoto(actor: Authorized, ticketId: string, bytes: Uint8Array) {
  const check = checkPhoto(bytes);
  if (!check.ok) throw new AppError(422, "INVALID_PHOTO", check.message);
  const storage = fileStorage();
  const key = `tickets/${actor.organizationId}/${ticketId}/${randomBytes(16).toString("hex")}.${IMAGE_EXTENSION[check.type]}`;
  await storage.put(key, bytes, check.type);
  return { key, url: storage.url(key), storage };
}

/**
 * Reports a breakdown on a home of the organization, or from a task (its home and stay are used; an agent only from
 * their own tasks), optionally with a first photo. The reporter is the caller.
 */
export async function createTicket(actor: Authorized, input: NewTicketInput, photo?: Uint8Array): Promise<{ id: string }> {
  const { organizationId } = actor;
  let listingId = input.listingId;
  let bookingId: string | null = null;
  let taskId: string | null = null;
  if (input.taskId) {
    const task = await ticketSourceTask(actor, input.taskId);
    if (!task) throw new AppError(404, "NOT_FOUND", "Tâche introuvable.");
    ({ listingId, bookingId } = task);
    taskId = task.id;
  }
  const listing = listingId ? await db.listing.findFirst({ where: { id: listingId, organizationId, category: "HOME" }, select: { id: true } }) : null;
  if (!listing) throw new AppError(404, "NOT_FOUND", "Bien introuvable.");
  if (photo) {
    const check = checkPhoto(photo);
    if (!check.ok) throw new AppError(422, "INVALID_PHOTO", check.message);
  }

  const ticket = await db.$transaction(async (tx) => {
    const t = await tx.ticket.create({
      data: {
        organizationId,
        listingId: listing.id,
        bookingId,
        taskId,
        title: input.title,
        description: input.description,
        category: input.category,
        priority: input.priority,
        reporterId: actor.user.id,
      },
      select: { id: true },
    });
    await event(tx, actor, t.id, "CREATED", null, { priority: input.priority, category: input.category });
    await recordAudit(tx, {
      organizationId,
      actorId: actor.user.id,
      action: "ticket.created",
      targetType: "ticket",
      targetId: t.id,
      details: { listingId: listing.id, taskId, category: input.category, priority: input.priority },
    });
    return t;
  });
  if (photo) await addTicketPhoto(actor, ticket.id, photo);
  return ticket;
}

/** Adds a comment to the thread of a ticket the caller can see. */
export async function commentTicket(actor: Authorized, ticketId: string, body: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const t = await lockTicket(tx, actor, ticketId);
    await event(tx, actor, t.id, "COMMENT", body);
    await tx.ticket.update({ where: { id: t.id }, data: { updatedAt: new Date() } });
  });
}

const STATUS_REFUSAL = {
  FORBIDDEN: "Vous ne pouvez pas mettre cette panne dans ce statut.",
  SAME: "La panne est déjà dans ce statut.",
  WAITING_FOR: "En attente : d'une pièce ou d'un prestataire ?",
} as const;

/** Moves a ticket along (lib/operations/tickets.ts: associés anything, the assigned agent forward only). */
export async function setTicketStatus(actor: Authorized, ticketId: string, input: StatusInput): Promise<void> {
  await db.$transaction(async (tx) => {
    const t = await lockTicket(tx, actor, ticketId);
    const check = checkStatusChange(actorOf(actor), t, input.status, input.waitingFor);
    if (!check.ok) throw new AppError(check.reason === "FORBIDDEN" ? 403 : 409, "TICKET_STATUS", STATUS_REFUSAL[check.reason]);
    await tx.ticket.update({ where: { id: t.id }, data: statusFields(input.status, input.waitingFor, new Date()) });
    const details = { from: t.status, to: input.status, waitingFor: input.waitingFor };
    await event(tx, actor, t.id, "STATUS", input.note || null, details);
    await recordAudit(tx, { organizationId: actor.organizationId, actorId: actor.user.id, action: "ticket.status_changed", targetType: "ticket", targetId: t.id, details });
  });
}

/** Gives a ticket to a member of the team, or takes it back (null). Associés only. */
export async function assignTicket(actor: Authorized, ticketId: string, assigneeId: string | null): Promise<void> {
  await db.$transaction(async (tx) => {
    const t = await lockTicket(tx, actor, ticketId);
    requireManager(actor);
    if (t.assigneeId === assigneeId) return;
    if (assigneeId) await assertAssignee(tx, actor.organizationId, assigneeId);
    await tx.ticket.update({ where: { id: t.id }, data: { assigneeId } });
    const to = assigneeId ? await tx.user.findUnique({ where: { id: assigneeId }, select: { name: true } }) : null;
    await event(tx, actor, t.id, "ASSIGNED", null, { from: t.assigneeId, to: assigneeId, toName: to?.name ?? null });
    await recordAudit(tx, { organizationId: actor.organizationId, actorId: actor.user.id, action: "ticket.assigned", targetType: "ticket", targetId: t.id, details: { from: t.assigneeId, to: assigneeId } });
  });
}

/** Changes a ticket's priority. Associés only. */
export async function setTicketPriority(actor: Authorized, ticketId: string, priority: TicketPriority): Promise<void> {
  await db.$transaction(async (tx) => {
    const t = await lockTicket(tx, actor, ticketId);
    requireManager(actor);
    if (t.priority === priority) return;
    await tx.ticket.update({ where: { id: t.id }, data: { priority } });
    await event(tx, actor, t.id, "PRIORITY", null, { from: t.priority, to: priority });
    await recordAudit(tx, { organizationId: actor.organizationId, actorId: actor.user.id, action: "ticket.priority_changed", targetType: "ticket", targetId: t.id, details: { from: t.priority, to: priority } });
  });
}

/** The repair's cost (MAD) and whether it is to be re-invoiced to the owner (done in lot 6). Associés only. */
export async function setTicketCost(actor: Authorized, ticketId: string, input: CostInput): Promise<void> {
  await db.$transaction(async (tx) => {
    const t = await lockTicket(tx, actor, ticketId);
    requireManager(actor);
    if (t.costCents === input.costCents && t.rechargeOwner === input.rechargeOwner) return;
    await tx.ticket.update({ where: { id: t.id }, data: input });
    const details = { from: { costCents: t.costCents, rechargeOwner: t.rechargeOwner }, to: { costCents: input.costCents, rechargeOwner: input.rechargeOwner } };
    await event(tx, actor, t.id, "COST", null, details);
    await recordAudit(tx, { organizationId: actor.organizationId, actorId: actor.user.id, action: "ticket.cost_changed", targetType: "ticket", targetId: t.id, details });
  });
}

/** Adds a photo (JPEG, PNG or WebP by content, 5 MB) to a ticket the caller can see and that isn't cancelled. */
export async function addTicketPhoto(actor: Authorized, ticketId: string, bytes: Uint8Array): Promise<{ id: string; url: string }> {
  // Refuse at once what the caller can't touch, before writing any file.
  const visible = await db.ticket.findFirst({ where: { AND: [{ id: ticketId }, visibleWhere(actor)] }, select: { id: true } });
  if (!visible) throw ticketNotFound();
  const { key, url, storage } = await storePhoto(actor, ticketId, bytes);
  try {
    return await db.$transaction(async (tx) => {
      const t = await lockTicket(tx, actor, ticketId);
      if (t.status === "CANCELLED") throw new AppError(409, "TICKET_STATUS", `Cette panne est ${TICKET_STATUS_LABEL.CANCELLED.toLowerCase()}.`);
      if ((await tx.ticketPhoto.count({ where: { ticketId: t.id } })) >= MAX_TICKET_PHOTOS) {
        throw new AppError(422, "TOO_MANY_PHOTOS", `${MAX_TICKET_PHOTOS} photos au maximum par panne.`);
      }
      const photo = await tx.ticketPhoto.create({
        data: { organizationId: actor.organizationId, ticketId: t.id, storageKey: key, url, uploadedById: actor.user.id },
        select: { id: true, url: true },
      });
      await event(tx, actor, t.id, "PHOTO", null, { photoId: photo.id });
      return photo;
    });
  } catch (e) {
    await storage.delete(key).catch(() => {});
    throw e;
  }
}

/** Who may see a ticket photo (for app/media), or null when the key is no ticket photo. */
export async function ticketPhotoAccess(storageKey: string): Promise<{ organizationId: string; reporterId: string | null; assigneeId: string | null } | null> {
  const p = await db.ticketPhoto.findUnique({
    where: { storageKey },
    select: { organizationId: true, ticket: { select: { reporterId: true, assigneeId: true } } },
  });
  return p && { organizationId: p.organizationId, ...p.ticket };
}
