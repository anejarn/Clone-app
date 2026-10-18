import { todayInTimeZone } from "../dates";
import type { Prisma } from "../generated/prisma/client";
import { DEFAULT_CHECKLISTS, templateItems, type ChecklistTemplateItem } from "./checklist";
import { stayTaskSpecs, stayTimes, type TaskKind } from "./schedule";

/**
 * Field tasks generated from bookings, kept in sync with them. One entry point, syncBookingTasks(tx, bookingId),
 * called in the transaction of every booking write: the team's entries, changes of dates and cancellations
 * (lib/server/admin/bookings.ts), the site's bookings and cancellations (lib/server/bookings.ts), and any future
 * import (iCal, e-mails: lot 7) — and by the backfill (scripts/backfill-tasks.ts, prisma/seed.ts). Idempotent: running
 * it twice changes nothing.
 *
 * Rules:
 * - a confirmed guest stay (DIRECT or a platform) on a home gets three tasks: LINEN and CHECKIN on the arrival day,
 *   CLEANING on the departure day (lib/operations/schedule.ts), each with a copy of its type's check-list; a task
 *   whose day is already past isn't created;
 * - owner blocks get none (the owner's own stay: the team adds a cleaning by hand if the owner asks for one), nor do
 *   imported platform « Not available » blocks (channelBlock, lot 7: no guest is coming);
 * - new dates move the tasks not started yet (TODO) whose day changed; started or done tasks stay as they are;
 * - a cancelled stay cancels its TODO tasks; started and done ones are kept (the agent or an associé closes them);
 * - a cleaning is flagged `turnover` when another stay or owner block arrives the day the guest leaves; the flags of
 *   the home's cleanings on the days touched (old and new dates) are recomputed each time.
 * Only this module writes generated tasks; nothing here checks permissions (the callers did).
 */

type Tx = Prisma.TransactionClient;

export interface SyncResult {
  created: number;
  moved: number;
  cancelled: number;
}

const GENERATED: readonly Exclude<TaskKind, "OTHER">[] = ["LINEN", "CHECKIN", "CLEANING"];

/** The organization's templates, creating the default ones that are missing. */
export async function checklistTemplates(tx: Tx, organizationId: string): Promise<Record<TaskKind, ChecklistTemplateItem[]>> {
  const rows = await tx.checklistTemplate.findMany({ where: { organizationId }, select: { type: true, items: true } });
  const missing = (Object.keys(DEFAULT_CHECKLISTS) as TaskKind[]).filter((t) => !rows.some((r) => r.type === t));
  if (missing.length) {
    await tx.checklistTemplate.createMany({
      data: missing.map((type) => ({ organizationId, type, items: DEFAULT_CHECKLISTS[type] })),
      skipDuplicates: true,
    });
  }
  const out = { ...DEFAULT_CHECKLISTS };
  for (const r of rows) out[r.type] = templateItems(r.items, r.type);
  return out;
}

/** The items of a new task, from a template. */
export function itemsData(organizationId: string, taskId: string, items: readonly ChecklistTemplateItem[]) {
  return items.map((it, position) => ({ organizationId, taskId, position, label: it.label, requiresPhoto: it.requiresPhoto }));
}

export async function syncBookingTasks(
  tx: Tx,
  bookingId: string,
  opts: { today?: Date; now?: Date; previous?: { checkIn: Date; checkOut: Date } } = {},
): Promise<SyncResult> {
  const result: SyncResult = { created: 0, moved: 0, cancelled: 0 };
  const b = await tx.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      organizationId: true,
      listingId: true,
      source: true,
      status: true,
      channelBlock: true,
      checkIn: true,
      checkOut: true,
      organization: { select: { checkInMinutes: true, checkOutMinutes: true } },
      listing: { select: { category: true, checkInMinutes: true, checkOutMinutes: true, place: { select: { timezone: true } } } },
    },
  });
  if (!b) return result;
  const now = opts.now ?? new Date();
  const existing = await tx.task.findMany({ where: { bookingId: b.id }, select: { id: true, type: true, status: true, anchorDate: true } });
  // Days whose turnover flags may change: the stay's dates now, before, and those its tasks were placed on.
  const days = [b.checkIn, b.checkOut, ...(opts.previous ? [opts.previous.checkIn, opts.previous.checkOut] : []), ...existing.flatMap((t) => (t.anchorDate ? [t.anchorDate] : []))];

  const wanted = b.status === "CONFIRMED" && b.source !== "OWNER" && !b.channelBlock && b.listing.category === "HOME";
  if (!wanted) {
    const r = await tx.task.updateMany({ where: { bookingId: b.id, status: "TODO" }, data: { status: "CANCELLED", cancelledAt: now } });
    result.cancelled = r.count;
  } else {
    const timeZone = b.listing.place.timezone;
    const today = opts.today ?? todayInTimeZone(timeZone, now.getTime());
    const specs = stayTaskSpecs(b, stayTimes(b.organization, b.listing), timeZone);
    let templates: Record<TaskKind, ChecklistTemplateItem[]> | undefined;
    for (const type of GENERATED) {
      const spec = specs.find((s) => s.type === type)!;
      const task = existing.find((t) => t.type === type);
      const when = { scheduledDate: spec.scheduledDate, startsAt: spec.startsAt, endsAt: spec.endsAt, anchorDate: spec.anchorDate };
      if (!task) {
        if (spec.anchorDate < today) continue;
        templates ??= await checklistTemplates(tx, b.organizationId);
        const created = await tx.task.create({
          data: { organizationId: b.organizationId, listingId: b.listingId, bookingId: b.id, type, ...when },
          select: { id: true },
        });
        await tx.taskChecklistItem.createMany({ data: itemsData(b.organizationId, created.id, templates[type]) });
        result.created += 1;
      } else if (task.status === "TODO" && task.anchorDate?.getTime() !== spec.anchorDate.getTime()) {
        await tx.task.update({ where: { id: task.id }, data: when });
        result.moved += 1;
      }
    }
  }
  await refreshTurnovers(tx, b.listingId, days);
  return result;
}

/** Recomputes the turnover flag of the home's cleanings after stays leaving on `days`. */
export async function refreshTurnovers(tx: Tx, listingId: string, days: readonly Date[]): Promise<void> {
  const unique = [...new Map(days.map((d) => [d.getTime(), d])).values()];
  if (!unique.length) return;
  const cleanings = await tx.task.findMany({
    where: { listingId, type: "CLEANING", bookingId: { not: null }, booking: { checkOut: { in: unique } } },
    select: { id: true, turnover: true, bookingId: true, booking: { select: { checkOut: true } } },
  });
  if (!cleanings.length) return;
  const arrivals = await tx.booking.findMany({ where: { listingId, status: "CONFIRMED", checkIn: { in: unique } }, select: { id: true, checkIn: true } });
  for (const c of cleanings) {
    const turnover = arrivals.some((a) => a.id !== c.bookingId && a.checkIn.getTime() === c.booking!.checkOut.getTime());
    if (turnover !== c.turnover) await tx.task.update({ where: { id: c.id }, data: { turnover } });
  }
}

/** A member who leaves the team (role changed, deactivated): their open tasks go back to "unassigned". */
export async function releaseOpenTasks(tx: Tx, organizationId: string, userId: string): Promise<number> {
  const r = await tx.task.updateMany({
    where: { organizationId, assigneeId: userId, status: { in: ["TODO", "IN_PROGRESS"] } },
    data: { assigneeId: null },
  });
  return r.count;
}

/**
 * Creates the missing tasks of every confirmed stay not over yet (all organizations, or one). Safe to run again.
 * `client` is a Prisma client or transaction; each stay is synced on its own.
 */
export async function backfillTasks(client: Tx, opts: { organizationId?: string; today?: Date } = {}): Promise<SyncResult & { bookings: number }> {
  // A day of margin: "today" is each home's local date, decided by syncBookingTasks.
  const since = new Date((opts.today ?? todayInTimeZone("UTC")).getTime() - 86_400_000);
  const bookings = await client.booking.findMany({
    where: { status: "CONFIRMED", source: { not: "OWNER" }, channelBlock: false, checkOut: { gte: since }, ...(opts.organizationId && { organizationId: opts.organizationId }) },
    select: { id: true },
    orderBy: [{ checkIn: "asc" }, { id: "asc" }],
  });
  const total: SyncResult & { bookings: number } = { created: 0, moved: 0, cancelled: 0, bookings: bookings.length };
  for (const { id } of bookings) {
    const r = await syncBookingTasks(client, id, { today: opts.today });
    total.created += r.created;
    total.moved += r.moved;
    total.cancelled += r.cancelled;
  }
  return total;
}
