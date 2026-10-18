import { z } from "zod";
import type { TaskState } from "./labels";

/**
 * « Ma journée » offline changes: what the phone queues and the server applies (lib/server/operations/field-sync.ts).
 * Pure, shared by both sides and unit-tested.
 *
 * Each change is one operation with an id made on the phone (opId, random). The server records every operation it
 * has decided on (applied or refused) under (user, opId): sending the same operation again — the answer was lost,
 * the phone retried — returns the recorded outcome and changes nothing (idempotency).
 *
 * Conflicts: the server wins. If the task was taken from the agent (reassigned, unassigned) or cancelled while they
 * were offline, or it was finished by someone else, the operation is refused with a message the agent can read;
 * see decideFieldOp(). Ticks and notes are absolute values (checked or not, the whole text), so applying them again
 * gives the same result.
 */

export const FIELD_OP_KINDS = ["start", "check", "note", "photo", "complete"] as const;
export type FieldOpKind = (typeof FIELD_OP_KINDS)[number];

/** Same rule as the database (task_sync_operations_check). crypto.randomUUID() matches it. */
export const OP_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const FIELD_NOTES_MAX = 2000;
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** A new operation id: 122 random bits. */
export function newOpId(): string {
  return crypto.randomUUID();
}

const base = {
  opId: z.string().regex(OP_ID_RE, "identifiant d'opération invalide"),
  taskId: z.string().regex(ID_RE, "tâche invalide"),
  /** When the agent made the change, on the phone's clock (ISO 8601). */
  at: z.iso.datetime({ offset: true }).optional(),
};

export const fieldOpSchema = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("start") }),
  z.object({ ...base, kind: z.literal("check"), itemId: z.string().regex(ID_RE, "élément invalide"), checked: z.boolean() }),
  z.object({
    ...base,
    kind: z.literal("note"),
    notes: z
      .string()
      .max(FIELD_NOTES_MAX, `Remarques : ${FIELD_NOTES_MAX} caractères au maximum`)
      .refine((s) => !CONTROL_RE.test(s), "Remarques : caractères non autorisés"),
  }),
  /** The photo itself travels with the operation (multipart field `photo`). */
  z.object({ ...base, kind: z.literal("photo"), itemId: z.string().regex(ID_RE, "élément invalide") }),
  z.object({ ...base, kind: z.literal("complete") }),
]);

export type FieldOp = z.infer<typeof fieldOpSchema>;

export type RejectionCode =
  | "TASK_GONE"
  | "TASK_CANCELLED"
  | "TASK_DONE"
  | "TASK_NOT_STARTED"
  | "TASK_INCOMPLETE"
  | "ITEM_GONE"
  | "INVALID_PHOTO"
  | "TOO_MANY_PHOTOS"
  | "INVALID_OPERATION";

/** What the agent reads when the server refused one of their changes. */
export const REJECTION_MESSAGE: Record<RejectionCode, string> = {
  TASK_GONE: "Cette tâche ne vous est plus confiée (réaffectée ou retirée) : ce changement n'a pas été enregistré.",
  TASK_CANCELLED: "Cette tâche a été annulée entre-temps : ce changement n'a pas été enregistré.",
  TASK_DONE: "Cette tâche a déjà été terminée : ce changement n'a pas été enregistré.",
  TASK_NOT_STARTED: "Cette tâche a été remise « à faire » entre-temps : commencez-la à nouveau.",
  TASK_INCOMPLETE: "La tâche n'a pas pu être terminée.",
  ITEM_GONE: "Cet élément de la check-list n'existe plus : ce changement n'a pas été enregistré.",
  INVALID_PHOTO: "Cette photo n'a pas été acceptée.",
  TOO_MANY_PHOTOS: "Trop de photos pour cette tâche.",
  INVALID_OPERATION: "Ce changement n'a pas pu être lu par le serveur.",
};

export type FieldOpDecision = { action: "apply" } | { action: "noop" } | { action: "reject"; code: RejectionCode };

/**
 * What the server does with an operation, given the task's state now (null: the task isn't the agent's any more —
 * reassigned, unassigned, deleted, or never theirs). The server wins on the task's state; the agent's intent is
 * honoured when it is already met (starting a task already in progress, finishing one already done: nothing to do).
 */
export function decideFieldOp(kind: FieldOpKind, status: TaskState | null): FieldOpDecision {
  if (status === null) return { action: "reject", code: "TASK_GONE" };
  if (status === "CANCELLED") return { action: "reject", code: "TASK_CANCELLED" };
  switch (kind) {
    case "start":
      return status === "TODO" ? { action: "apply" } : { action: "noop" };
    case "note":
      return { action: "apply" };
    case "check":
    case "photo":
      if (status === "IN_PROGRESS") return { action: "apply" };
      return { action: "reject", code: status === "DONE" ? "TASK_DONE" : "TASK_NOT_STARTED" };
    case "complete":
      if (status === "IN_PROGRESS") return { action: "apply" };
      return status === "DONE" ? { action: "noop" } : { action: "reject", code: "TASK_NOT_STARTED" };
  }
}

/** The server's answer for one operation (POST /api/admin/journee/operations). */
export interface FieldOpResult {
  opId: string;
  outcome: "APPLIED" | "REJECTED";
  code?: RejectionCode;
  message?: string;
  /** True when this operation had already been decided: nothing was changed this time. */
  replayed: boolean;
}

/** How far ahead of the server the phone's clock may be before its time is ignored. */
const MAX_CLOCK_AHEAD_MS = 5 * 60_000;
/** Changes older than this are still applied, but their phone time isn't kept. */
const MAX_OFFLINE_AGE_MS = 14 * 86_400_000;

/** The phone's time of a change if plausible, else null (the server's time is used). */
export function plausibleClientTime(at: string | undefined, now = Date.now()): Date | null {
  if (!at) return null;
  const t = Date.parse(at);
  if (Number.isNaN(t) || t > now + MAX_CLOCK_AHEAD_MS || t < now - MAX_OFFLINE_AGE_MS) return null;
  return new Date(t);
}
