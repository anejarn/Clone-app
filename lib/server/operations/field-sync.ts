import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { decideFieldOp, plausibleClientTime, REJECTION_MESSAGE, type FieldOp, type FieldOpResult, type RejectionCode } from "@/lib/operations/field-ops";
import { fileStorage } from "@/lib/storage";
import type { Authorized } from "../authz";
import { db } from "../db";
import { AppError } from "../errors";
import { completeLocked, insertTaskPhotoLocked, lockTask, setFieldNotesLocked, setItemCheckedLocked, startLocked, storeTaskPhotoFile, type Locked } from "./tasks";

/**
 * « Ma journée »: applies one change sent by the agent's phone, made online or queued offline (lib/offline/). Rules
 * (lib/operations/field-ops.ts): every operation is decided once per (agent, opId) and recorded in
 * task_sync_operations with its outcome; sending it again returns that outcome without changing anything. The server
 * wins: a task taken from the agent or cancelled meanwhile refuses the change with a message for the agent.
 *
 * Only the tasks assigned to the caller are reachable here, associés included (it is *their* day); anything else is
 * TASK_GONE, which says nothing about whether the task exists. Status changes are audited with `offline: true`.
 */

type Recorded = { outcome: "APPLIED" | "REJECTED"; code: string | null; message: string | null };

const asResult = (opId: string, r: Recorded, replayed: boolean): FieldOpResult => ({
  opId,
  outcome: r.outcome,
  ...(r.code && { code: r.code as RejectionCode }),
  ...(r.message && { message: r.message }),
  replayed,
});

async function recorded(actor: Authorized, opId: string): Promise<Recorded | null> {
  return db.taskSyncOperation.findUnique({ where: { userId_opId: { userId: actor.user.id, opId } }, select: { outcome: true, code: true, message: true } });
}

// Prisma's error code for a unique violation (as in lib/server/admin/bookings.ts); driver-adapter errors aren't always instances.
const isUniqueViolation = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";

/** Locks the task if it is the caller's own (any role); null otherwise. */
async function lockOwnTask(tx: Prisma.TransactionClient, actor: Authorized, taskId: string): Promise<Locked | null> {
  try {
    const t = await lockTask(tx, actor, taskId);
    return t.assigneeId === actor.user.id ? t : null;
  } catch (e) {
    if (e instanceof AppError && e.status === 404) return null;
    throw e;
  }
}

/** An AppError thrown while applying, as the agent's refusal. Anything else is a real error (500, retried). */
function rejectionOf(e: unknown): { code: RejectionCode; message: string } | null {
  if (!(e instanceof AppError)) return null;
  switch (e.code) {
    case "TASK_INCOMPLETE":
      return { code: "TASK_INCOMPLETE", message: `${REJECTION_MESSAGE.TASK_INCOMPLETE} ${e.message}` };
    case "ITEM_NOT_FOUND":
      return { code: "ITEM_GONE", message: REJECTION_MESSAGE.ITEM_GONE };
    case "INVALID_PHOTO":
      return { code: "INVALID_PHOTO", message: `${REJECTION_MESSAGE.INVALID_PHOTO} ${e.message}` };
    case "TOO_MANY_PHOTOS":
      return { code: "TOO_MANY_PHOTOS", message: e.message };
    default:
      return null;
  }
}

class Rejected extends Error {
  constructor(readonly code: RejectionCode) {
    super(code);
  }
}

/**
 * Applies `op` for the caller (with its photo for a "photo" operation), once. Returns the outcome; throws only for
 * errors that are worth retrying (database down…).
 */
export async function applyFieldOp(actor: Authorized, op: FieldOp, photo?: Uint8Array): Promise<FieldOpResult> {
  const before = await recorded(actor, op.opId);
  if (before) return asResult(op.opId, before, true);
  const clientAt = plausibleClientTime(op.at);
  const row = { organizationId: actor.organizationId, userId: actor.user.id, opId: op.opId, taskId: op.taskId, kind: op.kind, clientAt };

  // A photo is written to the store first (as in Mes tâches), and removed again if the change doesn't go through.
  let key: string | null = null;
  try {
    if (op.kind === "photo") {
      if (!photo) throw new AppError(422, "INVALID_PHOTO", "Aucune photo reçue.");
      // Refuse at once what the caller can't touch, before writing any file.
      const own = await db.task.count({ where: { id: op.taskId, organizationId: actor.organizationId, assigneeId: actor.user.id } });
      if (!own) throw new Rejected("TASK_GONE");
      key = await storeTaskPhotoFile(actor, op.taskId, photo);
    }
    await db.$transaction(async (tx) => {
      // First: claim the operation id. A concurrent copy of the same operation waits here, then fails (P2002).
      await tx.taskSyncOperation.create({ data: { ...row, outcome: "APPLIED" } });
      const t = await lockOwnTask(tx, actor, op.taskId);
      const decision = decideFieldOp(op.kind, t?.status ?? null);
      if (decision.action === "reject") throw new Rejected(decision.code);
      if (decision.action === "noop" || !t) return;
      switch (op.kind) {
        case "start":
          return startLocked(tx, actor, t, true);
        case "check":
          return setItemCheckedLocked(tx, actor, t, op.itemId, op.checked);
        case "note":
          return setFieldNotesLocked(tx, t, op.notes.trim());
        case "photo":
          await insertTaskPhotoLocked(tx, actor, t, op.itemId, key!);
          return;
        case "complete":
          return completeLocked(tx, actor, t, true);
      }
    });
    return { opId: op.opId, outcome: "APPLIED", replayed: false };
  } catch (e) {
    if (key) await fileStorage().delete(key).catch(() => {});
    if (isUniqueViolation(e)) {
      const other = await recorded(actor, op.opId);
      if (other) return asResult(op.opId, other, true);
      throw e;
    }
    const refusal = e instanceof Rejected ? { code: e.code, message: REJECTION_MESSAGE[e.code] } : rejectionOf(e);
    if (!refusal) throw e;
    // Recorded so that a retry gets the same answer (the server's state may have changed since, the answer doesn't).
    try {
      await db.taskSyncOperation.create({ data: { ...row, outcome: "REJECTED", code: refusal.code, message: refusal.message.slice(0, 500) } });
    } catch (again) {
      if (!isUniqueViolation(again)) throw again;
      const other = await recorded(actor, op.opId);
      if (other) return asResult(op.opId, other, true);
    }
    return { opId: op.opId, outcome: "REJECTED", code: refusal.code, message: refusal.message, replayed: false };
  }
}
