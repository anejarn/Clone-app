import "server-only";
import { randomBytes } from "node:crypto";
import { addDays, isoDay } from "@/lib/admin/calendar";
import { canSeeAllTasks } from "@/lib/admin/sections";
import type { ManualTaskInput, TaskTimeInput } from "@/lib/admin/task-form";
import { todayInTimeZone } from "@/lib/dates";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { BookingSource, TaskStatus, TaskType } from "@/lib/generated/prisma/enums";
import { MARRAKECH_TIMEZONE } from "@/lib/neighbourhoods";
import { blockersMessage, completionBlockers } from "@/lib/operations/checklist";
import { TASK_TYPE_TITLE } from "@/lib/operations/labels";
import { formatTimeOfDay, localDayAndMinutes, typedWindow } from "@/lib/operations/schedule";
import { checklistTemplates, itemsData } from "@/lib/operations/sync";
import { fileStorage } from "@/lib/storage";
import { checkPhoto, IMAGE_EXTENSION } from "@/lib/storage/images";
import { recordAudit } from "../audit";
import type { Authorized } from "../authz";
import { db } from "../db";
import { AppError } from "../errors";

/**
 * Field tasks (Opérations, Mes tâches). Generated tasks come from lib/operations/sync.ts; this module reads them and
 * carries out what the team does with them. Every function takes the caller (from lib/server/authz.ts) or their
 * organization, and only touches that organization's rows: another organization's task, listing or member is
 * answered 404 / refused like an unknown one.
 *
 * Who sees what: an associé (ADMIN) sees and works on every task of the organization; an agent (AGENT) only on the
 * tasks assigned to them — an unassigned task, or a colleague's, is "not found" for an agent (canSeeAllTasks).
 * Assigning, re-timing, typing, cancelling and reopening tasks are for associés (the actions check the Opérations
 * section first). Working on a task: start it (TODO → IN_PROGRESS), tick its items, add photos, finish it
 * (IN_PROGRESS → DONE), which needs every item ticked and a photo for every item that requires one, checked here in
 * a transaction holding the task's row. Assignments, new times and status changes are audited; ticks and photos are
 * recorded on the task itself (who, when).
 */

const taskNotFound = () => new AppError(404, "NOT_FOUND", "Tâche introuvable.");
const MAX_TASK_PHOTOS = 60;
export const TASK_LIST_LIMIT = 500;

const listSelect = {
  id: true,
  type: true,
  status: true,
  title: true,
  scheduledDate: true,
  startsAt: true,
  endsAt: true,
  turnover: true,
  notes: true,
  bookingId: true,
  startedAt: true,
  completedAt: true,
  cancelledAt: true,
  assignee: { select: { id: true, name: true } },
  listing: { select: { id: true, title: true, address: true, place: { select: { name: true, timezone: true } } } },
  booking: {
    select: { source: true, status: true, checkIn: true, checkOut: true, guestName: true, guestPhone: true, adults: true, children: true, guest: { select: { name: true, phone: true } } },
  },
  items: { select: { checkedAt: true, requiresPhoto: true, _count: { select: { photos: true } } } },
} satisfies Prisma.TaskSelect;

type ListRow = Prisma.TaskGetPayload<{ select: typeof listSelect }>;

/** A task as the team sees it; serializable (dates as strings), never an amount. */
export interface TaskView {
  id: string;
  type: TaskType;
  status: TaskStatus;
  /** The typed title, or the type's name. */
  title: string;
  listingId: string;
  listingTitle: string;
  address: string;
  placeName: string;
  /** Local day, yyyy-MM-dd. */
  scheduledDate: string;
  startsAt: string;
  endsAt: string;
  /** Local times, HH:MM. */
  startTime: string;
  endTime: string;
  turnover: boolean;
  notes: string | null;
  assignee: { id: string; name: string } | null;
  /** The stay it was generated from; null for a task typed by hand. */
  booking: {
    id: string;
    source: BookingSource;
    cancelled: boolean;
    checkIn: string;
    checkOut: string;
    guestName: string | null;
    guestPhone: string | null;
    guests: number;
  } | null;
  itemCount: number;
  checkedCount: number;
  /** Items that require a photo and have none yet. */
  missingPhotos: number;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}

function toView(t: ListRow): TaskView {
  const tz = t.listing.place.timezone;
  const start = localDayAndMinutes(t.startsAt, tz);
  const end = localDayAndMinutes(t.endsAt, tz);
  return {
    id: t.id,
    type: t.type,
    status: t.status,
    title: t.title ?? TASK_TYPE_TITLE[t.type],
    listingId: t.listing.id,
    listingTitle: t.listing.title,
    address: t.listing.address,
    placeName: t.listing.place.name,
    scheduledDate: isoDay(t.scheduledDate),
    startsAt: t.startsAt.toISOString(),
    endsAt: t.endsAt.toISOString(),
    startTime: formatTimeOfDay(start.minutes),
    endTime: formatTimeOfDay(end.minutes),
    turnover: t.turnover,
    notes: t.notes,
    assignee: t.assignee,
    booking:
      t.booking && t.bookingId
        ? {
            id: t.bookingId,
            source: t.booking.source,
            cancelled: t.booking.status === "CANCELLED",
            checkIn: isoDay(t.booking.checkIn),
            checkOut: isoDay(t.booking.checkOut),
            guestName: t.booking.guestName ?? t.booking.guest?.name ?? null,
            guestPhone: t.booking.guestPhone ?? t.booking.guest?.phone ?? null,
            guests: t.booking.adults + t.booking.children,
          }
        : null,
    itemCount: t.items.length,
    checkedCount: t.items.filter((i) => i.checkedAt).length,
    missingPhotos: t.items.filter((i) => i.requiresPhoto && i._count.photos === 0).length,
    startedAt: t.startedAt?.toISOString() ?? null,
    completedAt: t.completedAt?.toISOString() ?? null,
    cancelledAt: t.cancelledAt?.toISOString() ?? null,
  };
}

const order: Prisma.TaskOrderByWithRelationInput[] = [{ scheduledDate: "asc" }, { startsAt: "asc" }, { id: "asc" }];

/** Today in Marrakech: the default day of Opérations and Mes tâches. */
export function tasksToday(now = Date.now()): Date {
  return todayInTimeZone(MARRAKECH_TIMEZONE, now);
}

// ---------- Reading ----------

export interface TaskFilters {
  /** First day (local), included. */
  from: Date;
  /** Last day, excluded. */
  to: Date;
  listingId?: string;
  /** A member's id, or "none" for unassigned tasks. */
  assignee?: string;
  /** Default: every status but CANCELLED. */
  status?: TaskStatus;
  type?: TaskType;
}

/** The organization's tasks over [from, to), filtered (Opérations, associés). */
export async function listTasks(organizationId: string, f: TaskFilters): Promise<{ items: TaskView[]; truncated: boolean }> {
  const rows = await db.task.findMany({
    where: {
      organizationId,
      scheduledDate: { gte: f.from, lt: f.to },
      ...(f.listingId && { listingId: f.listingId }),
      ...(f.assignee === "none" ? { assigneeId: null } : f.assignee ? { assigneeId: f.assignee } : {}),
      ...(f.status ? { status: f.status } : { status: { not: "CANCELLED" } }),
      ...(f.type && { type: f.type }),
    },
    select: listSelect,
    orderBy: order,
    take: TASK_LIST_LIMIT + 1,
  });
  return { items: rows.slice(0, TASK_LIST_LIMIT).map(toView), truncated: rows.length > TASK_LIST_LIMIT };
}

/** The tasks assigned to the caller over [from, to), cancelled ones left out (Mes tâches). */
export async function myTasks(actor: Authorized, from: Date, to: Date): Promise<TaskView[]> {
  const rows = await db.task.findMany({
    where: { organizationId: actor.organizationId, assigneeId: actor.user.id, scheduledDate: { gte: from, lt: to }, status: { not: "CANCELLED" } },
    select: listSelect,
    orderBy: order,
    take: TASK_LIST_LIMIT,
  });
  return rows.map(toView);
}

export interface TaskItemView {
  id: string;
  label: string;
  requiresPhoto: boolean;
  checked: boolean;
  checkedAt: string | null;
  photos: { id: string; url: string }[];
}

export interface TaskDetail extends TaskView {
  items: TaskItemView[];
  /** What still stops it from being done (lib/operations/checklist.ts). */
  blockers: { unchecked: string[]; missingPhotos: string[] };
}

/**
 * One task with its check-list and photos, for the caller: any task of the organization for an associé, only
 * their own for an agent; null otherwise (unknown, another organization's, a colleague's or unassigned).
 */
export async function getTask(actor: Authorized, id: string): Promise<TaskDetail | null> {
  const row = await db.task.findFirst({
    where: { id, organizationId: actor.organizationId, ...(!canSeeAllTasks(actor.user.role) && { assigneeId: actor.user.id }) },
    select: {
      ...listSelect,
      items: {
        select: {
          id: true,
          label: true,
          requiresPhoto: true,
          checkedAt: true,
          position: true,
          photos: { select: { id: true, url: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
          _count: { select: { photos: true } },
        },
        orderBy: { position: "asc" },
      },
    },
  });
  if (!row) return null;
  const items: TaskItemView[] = row.items.map((i) => ({
    id: i.id,
    label: i.label,
    requiresPhoto: i.requiresPhoto,
    checked: !!i.checkedAt,
    checkedAt: i.checkedAt?.toISOString() ?? null,
    photos: i.photos,
  }));
  return {
    ...toView(row),
    items,
    blockers: completionBlockers(items.map((i) => ({ ...i, photoCount: i.photos.length }))),
  };
}

/** Members a task can be given to: active associés and agents of the organization. */
export async function taskAssignees(organizationId: string) {
  return db.user.findMany({
    where: { organizationId, role: { in: ["ADMIN", "AGENT"] }, deactivatedAt: null },
    select: { id: true, name: true, role: true },
    orderBy: [{ role: "desc" }, { name: "asc" }, { id: "asc" }],
  });
}

/** The organization's homes, for the filters and the manual task form. */
export async function taskListings(organizationId: string) {
  return db.listing.findMany({
    where: { organizationId, category: "HOME" },
    select: { id: true, title: true, address: true },
    orderBy: [{ title: "asc" }, { id: "asc" }],
  });
}

/** Counts for the dashboard: tasks today (not cancelled), and open tasks from today on with nobody assigned. */
export async function taskCounts(organizationId: string, today: Date): Promise<{ tasksToday: number; tasksUnassigned: number }> {
  const [tasksToday, tasksUnassigned] = await Promise.all([
    db.task.count({ where: { organizationId, scheduledDate: today, status: { not: "CANCELLED" } } }),
    db.task.count({ where: { organizationId, scheduledDate: { gte: today }, assigneeId: null, status: { in: ["TODO", "IN_PROGRESS"] } } }),
  ]);
  return { tasksToday, tasksUnassigned };
}

// ---------- Writing ----------

interface Locked {
  id: string;
  type: TaskType;
  status: TaskStatus;
  assigneeId: string | null;
  listingId: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
}

/** Holds the task's row until the end of the transaction; 404 unless the caller may work on it. */
async function lockTask(tx: Prisma.TransactionClient, actor: Authorized, taskId: string): Promise<Locked> {
  const rows = await tx.$queryRaw<Locked[]>`
    SELECT t."id", t."type", t."status", t."assigneeId", t."listingId", t."startsAt", t."endsAt", p."timezone"
    FROM "tasks" t JOIN "listings" l ON l."id" = t."listingId" JOIN "places" p ON p."id" = l."placeId"
    WHERE t."id" = ${taskId} AND t."organizationId" = ${actor.organizationId}
    FOR UPDATE OF t`;
  const t = rows[0];
  if (!t || (!canSeeAllTasks(actor.user.role) && t.assigneeId !== actor.user.id)) throw taskNotFound();
  return t;
}

const STATE_REFUSAL: Record<TaskStatus, string> = {
  TODO: "Commencez d'abord la tâche (« Commencer »).",
  IN_PROGRESS: "Cette tâche est déjà en cours.",
  DONE: "Cette tâche est déjà faite.",
  CANCELLED: "Cette tâche est annulée.",
};

function requireStatus(t: Locked, allowed: readonly TaskStatus[]) {
  if (!allowed.includes(t.status)) throw new AppError(409, "TASK_STATE", STATE_REFUSAL[t.status]);
}

async function statusChanged(tx: Prisma.TransactionClient, actor: Authorized, t: Locked, to: TaskStatus) {
  await recordAudit(tx, {
    organizationId: actor.organizationId,
    actorId: actor.user.id,
    action: "task.status_changed",
    targetType: "task",
    targetId: t.id,
    details: { type: t.type, from: t.status, to },
  });
}

/** A member a task can be given to, or 422 (another organization's account reads the same as an unknown one). */
async function assertAssignee(tx: Prisma.TransactionClient, organizationId: string, userId: string) {
  const ok = await tx.user.count({ where: { id: userId, organizationId, role: { in: ["ADMIN", "AGENT"] }, deactivatedAt: null } });
  if (!ok) throw new AppError(422, "INVALID_ASSIGNEE", "Choisissez un membre actif de l'équipe (associé ou agent).");
}

/** Gives a task to a member of the team, or takes it back (null). Associés only. */
export async function assignTask(actor: Authorized, taskId: string, assigneeId: string | null): Promise<void> {
  await db.$transaction(async (tx) => {
    const t = await lockTask(tx, actor, taskId);
    requireStatus(t, ["TODO", "IN_PROGRESS"]);
    if (t.assigneeId === assigneeId) return;
    if (assigneeId) await assertAssignee(tx, actor.organizationId, assigneeId);
    await tx.task.update({ where: { id: t.id }, data: { assigneeId } });
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.user.id,
      action: "task.assigned",
      targetType: "task",
      targetId: t.id,
      details: { type: t.type, from: t.assigneeId, to: assigneeId },
    });
  });
}

/** Day and time window of a typed task, checked: today or later, at most two years ahead, ending after it starts. */
function typedSchedule(input: TaskTimeInput, timeZone: string, today: Date) {
  if (input.day < today) throw new AppError(422, "INVALID_DATE", "Choisissez aujourd'hui ou un jour à venir.");
  if (input.day > addDays(today, 730)) throw new AppError(422, "INVALID_DATE", "Au plus deux ans à l'avance.");
  const w = typedWindow(input.day, input.start, input.end, timeZone);
  if (!w) throw new AppError(422, "INVALID_TIME", "L'heure de fin doit être après l'heure de début.");
  return { scheduledDate: input.day, ...w };
}

/** New day and time window for a task not done yet. Associés only. A later change of the stay's dates moves it again. */
export async function rescheduleTask(actor: Authorized, taskId: string, input: TaskTimeInput, today?: Date): Promise<void> {
  await db.$transaction(async (tx) => {
    const t = await lockTask(tx, actor, taskId);
    requireStatus(t, ["TODO", "IN_PROGRESS"]);
    const when = typedSchedule(input, t.timezone, today ?? todayInTimeZone(t.timezone));
    await tx.task.update({ where: { id: t.id }, data: when });
    await recordAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.user.id,
      action: "task.rescheduled",
      targetType: "task",
      targetId: t.id,
      details: { type: t.type, from: { startsAt: t.startsAt.toISOString(), endsAt: t.endsAt.toISOString() }, to: { startsAt: when.startsAt.toISOString(), endsAt: when.endsAt.toISOString() } },
    });
  });
}

/** A task typed by hand on a home of the organization (e.g. a cleaning after an owner's stay). Associés only. */
export async function createManualTask(actor: Authorized, input: ManualTaskInput, today?: Date): Promise<{ id: string }> {
  const { organizationId } = actor;
  return db.$transaction(async (tx) => {
    const listing = await tx.listing.findFirst({ where: { id: input.listingId, organizationId, category: "HOME" }, select: { id: true, place: { select: { timezone: true } } } });
    if (!listing) throw new AppError(404, "NOT_FOUND", "Bien introuvable.");
    const when = typedSchedule(input, listing.place.timezone, today ?? todayInTimeZone(listing.place.timezone));
    if (input.assigneeId) await assertAssignee(tx, organizationId, input.assigneeId);
    const task = await tx.task.create({
      data: {
        organizationId,
        listingId: listing.id,
        type: input.type,
        title: input.title || null,
        notes: input.notes || null,
        assigneeId: input.assigneeId,
        createdById: actor.user.id,
        ...when,
      },
      select: { id: true },
    });
    const templates = await checklistTemplates(tx, organizationId);
    await tx.taskChecklistItem.createMany({ data: itemsData(organizationId, task.id, templates[input.type]) });
    await recordAudit(tx, {
      organizationId,
      actorId: actor.user.id,
      action: "task.created",
      targetType: "task",
      targetId: task.id,
      details: { type: input.type, listingId: listing.id, scheduledDate: isoDay(input.day), assigneeId: input.assigneeId },
    });
    return task;
  });
}

/** Changes a task's notes (associés). */
export async function updateTaskNotes(actor: Authorized, taskId: string, notes: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const t = await lockTask(tx, actor, taskId);
    await tx.task.update({ where: { id: t.id }, data: { notes: notes || null } });
  });
}

/** Cancels a task not done yet (associés). */
export async function cancelTask(actor: Authorized, taskId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const t = await lockTask(tx, actor, taskId);
    requireStatus(t, ["TODO", "IN_PROGRESS"]);
    await tx.task.update({ where: { id: t.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    await statusChanged(tx, actor, t, "CANCELLED");
  });
}

/** Puts a done or cancelled task back to "à faire" (associés); its ticks and photos are kept. */
export async function reopenTask(actor: Authorized, taskId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const t = await lockTask(tx, actor, taskId);
    requireStatus(t, ["DONE", "CANCELLED"]);
    await tx.task.update({ where: { id: t.id }, data: { status: "TODO", startedAt: null, completedAt: null, cancelledAt: null } });
    await statusChanged(tx, actor, t, "TODO");
  });
}

/** À faire → en cours (the agent it is assigned to, or an associé). */
export async function startTask(actor: Authorized, taskId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const t = await lockTask(tx, actor, taskId);
    requireStatus(t, ["TODO"]);
    await tx.task.update({ where: { id: t.id }, data: { status: "IN_PROGRESS", startedAt: new Date() } });
    await statusChanged(tx, actor, t, "IN_PROGRESS");
  });
}

/** Ticks or unticks an item of a task in progress. */
export async function setItemChecked(actor: Authorized, taskId: string, itemId: string, checked: boolean): Promise<void> {
  await db.$transaction(async (tx) => {
    const t = await lockTask(tx, actor, taskId);
    requireStatus(t, ["IN_PROGRESS"]);
    const r = await tx.taskChecklistItem.updateMany({
      where: { id: itemId, taskId: t.id },
      data: checked ? { checkedAt: new Date(), checkedById: actor.user.id } : { checkedAt: null, checkedById: null },
    });
    if (r.count === 0) throw new AppError(404, "NOT_FOUND", "Élément introuvable.");
  });
}

/**
 * Stores a photo of a task in progress (JPEG, PNG or WebP, checked by content, 5 MB at most), for one of its items.
 * The file is written first and removed again if the row can't be.
 */
export async function addTaskPhoto(actor: Authorized, taskId: string, itemId: string, bytes: Uint8Array): Promise<{ id: string; url: string }> {
  // Refuse at once what the caller can't touch, before writing any file.
  const visible = await db.task.findFirst({
    where: { id: taskId, organizationId: actor.organizationId, ...(!canSeeAllTasks(actor.user.role) && { assigneeId: actor.user.id }) },
    select: { id: true },
  });
  if (!visible) throw taskNotFound();
  const check = checkPhoto(bytes);
  if (!check.ok) throw new AppError(422, "INVALID_PHOTO", check.message);
  const storage = fileStorage();
  const key = `tasks/${actor.organizationId}/${taskId}/${randomBytes(16).toString("hex")}.${IMAGE_EXTENSION[check.type]}`;
  await storage.put(key, bytes, check.type);
  try {
    return await db.$transaction(async (tx) => {
      const t = await lockTask(tx, actor, taskId);
      requireStatus(t, ["IN_PROGRESS"]);
      const item = await tx.taskChecklistItem.findFirst({ where: { id: itemId, taskId: t.id }, select: { id: true } });
      if (!item) throw new AppError(404, "NOT_FOUND", "Élément introuvable.");
      if ((await tx.taskPhoto.count({ where: { taskId: t.id } })) >= MAX_TASK_PHOTOS) {
        throw new AppError(422, "TOO_MANY_PHOTOS", `${MAX_TASK_PHOTOS} photos au maximum par tâche.`);
      }
      return tx.taskPhoto.create({
        data: { organizationId: actor.organizationId, taskId: t.id, itemId: item.id, storageKey: key, url: storage.url(key), uploadedById: actor.user.id },
        select: { id: true, url: true },
      });
    });
  } catch (e) {
    await storage.delete(key).catch(() => {});
    throw e;
  }
}

/** Deletes a photo of a task in progress, and its file. */
export async function deleteTaskPhoto(actor: Authorized, taskId: string, photoId: string): Promise<void> {
  const removed = await db.$transaction(async (tx) => {
    const t = await lockTask(tx, actor, taskId);
    requireStatus(t, ["IN_PROGRESS"]);
    const photo = await tx.taskPhoto.findFirst({ where: { id: photoId, taskId: t.id }, select: { id: true, storageKey: true } });
    if (!photo) throw new AppError(404, "NOT_FOUND", "Photo introuvable.");
    await tx.taskPhoto.delete({ where: { id: photo.id } });
    return photo;
  });
  await fileStorage().delete(removed.storageKey).catch((e) => console.error("task photo file not deleted", e));
}

/** En cours → fait, only with every item ticked and every required photo (422 TASK_INCOMPLETE otherwise). */
export async function completeTask(actor: Authorized, taskId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const t = await lockTask(tx, actor, taskId);
    requireStatus(t, ["IN_PROGRESS"]);
    const items = await tx.taskChecklistItem.findMany({
      where: { taskId: t.id },
      select: { id: true, label: true, requiresPhoto: true, checkedAt: true, _count: { select: { photos: true } } },
      orderBy: { position: "asc" },
    });
    const blockers = completionBlockers(items.map((i) => ({ id: i.id, label: i.label, requiresPhoto: i.requiresPhoto, checked: !!i.checkedAt, photoCount: i._count.photos })));
    if (blockers.unchecked.length || blockers.missingPhotos.length) throw new AppError(422, "TASK_INCOMPLETE", blockersMessage(blockers));
    await tx.task.update({ where: { id: t.id }, data: { status: "DONE", completedAt: new Date() } });
    await statusChanged(tx, actor, t, "DONE");
  });
}

/** The organization a task photo belongs to (for app/media), or null when the key is no task photo. */
export async function taskPhotoAccess(storageKey: string): Promise<{ organizationId: string } | null> {
  return db.taskPhoto.findUnique({ where: { storageKey }, select: { organizationId: true } });
}
