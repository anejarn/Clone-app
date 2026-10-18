import { completionBlockers, type CompletionBlockers } from "@/lib/operations/checklist";
import type { FieldOp, FieldOpResult } from "@/lib/operations/field-ops";
import type { TaskState } from "@/lib/operations/labels";

/**
 * « Ma journée » on the phone: the changes queue and how it is sent. Pure logic over a small store interface
 * (IndexedDB in the app, lib/offline/store.ts; memory in the unit tests).
 *
 * - Every change is queued first, then sent in order when the phone is online (immediately if it already is).
 * - The page shows the server's last snapshot with the queued changes applied on top (applyPending).
 * - Sending stops at the first change that can't be decided now (no network, signed out, server error) and resumes
 *   later from there, so the order is kept. A change the server decided — applied, or refused because the server
 *   wins (task reassigned or cancelled meanwhile…) — leaves the queue; a refusal is kept as a conflict for the agent
 *   to read. The server answers a change sent twice with its first answer (idempotency by opId).
 */

export interface DayItem {
  id: string;
  label: string;
  requiresPhoto: boolean;
  checked: boolean;
  photos: { id: string; url: string }[];
  /** Photos taken on the phone and not sent yet. */
  pendingPhotos?: number;
}

export interface DayTask {
  id: string;
  type: string;
  status: TaskState;
  title: string;
  listingTitle: string;
  address: string;
  placeName: string;
  scheduledDate: string;
  startTime: string;
  endTime: string;
  turnover: boolean;
  notes: string | null;
  fieldNotes: string | null;
  booking: { guestName: string | null; guestPhone: string | null; guests: number; cancelled: boolean } | null;
  items: DayItem[];
  /** Changes of this task not sent yet. */
  pendingOps?: number;
}

export interface DaySnapshot {
  user: { id: string; name: string };
  today: string;
  days: string[];
  tasks: DayTask[];
  generatedAt: string;
}

export type QueuedOp = FieldOp & {
  /** Order in the queue (IndexedDB key). */
  seq?: number;
  /** Who made the change: only theirs are sent, with their session. */
  userId: string;
  queuedAt: string;
  photo?: Blob;
};

export interface Conflict {
  opId: string;
  taskId: string;
  taskTitle: string;
  kind: FieldOp["kind"];
  message: string;
  at: string;
}

export interface QueueStore {
  /** Every queued change, in order. */
  list(): Promise<QueuedOp[]>;
  remove(seq: number): Promise<void>;
  addConflict(c: Conflict): Promise<void>;
}

/** What became of one attempt to send a change. */
export type SendOutcome =
  | { kind: "decided"; result: FieldOpResult }
  /** Can never succeed as it is (unreadable operation…): dropped, kept as a conflict. */
  | { kind: "final"; message: string }
  /** Try again later: no network, signed out, server error. */
  | { kind: "retry"; reason: "offline" | "auth" | "server"; message: string };

export const RETRY_MESSAGE = {
  offline: "Hors connexion : vos changements seront envoyés au retour du réseau.",
  auth: "Reconnectez-vous pour envoyer vos changements : ils restent enregistrés sur ce téléphone.",
  server: "Le serveur ne répond pas : nouvel essai dans un moment.",
} as const;

/** Maps an HTTP answer of POST /api/admin/journee/operations (status 0 = no answer at all). */
export function classifyResponse(status: number, body: unknown): SendOutcome {
  const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
  if (status === 0) return { kind: "retry", reason: "offline", message: RETRY_MESSAGE.offline };
  if (status === 200) {
    const result = (body as { result?: FieldOpResult } | null)?.result;
    if (result && (result.outcome === "APPLIED" || result.outcome === "REJECTED")) return { kind: "decided", result };
    return { kind: "retry", reason: "server", message: RETRY_MESSAGE.server };
  }
  if (status === 401 || status === 403) return { kind: "retry", reason: "auth", message: RETRY_MESSAGE.auth };
  if (status === 400 || status === 404 || status === 413 || status === 422) return { kind: "final", message: err?.message ?? "Ce changement n'a pas été accepté." };
  return { kind: "retry", reason: "server", message: RETRY_MESSAGE.server };
}

export interface FlushReport {
  applied: number;
  rejected: Conflict[];
  /** Why sending stopped before the end of the queue, if it did. */
  stopped: SendOutcome & { kind: "retry" } | null;
}

/**
 * Sends `userId`'s queued changes in order with `send`, until the queue is empty or a change must wait. Another
 * person's changes (an earlier session on this phone) are never sent.
 */
export async function flushQueue(
  store: QueueStore,
  userId: string,
  send: (op: QueuedOp) => Promise<SendOutcome>,
  taskTitle: (taskId: string) => string = () => "Tâche",
): Promise<FlushReport> {
  const report: FlushReport = { applied: 0, rejected: [], stopped: null };
  for (const op of await store.list()) {
    if (op.userId !== userId) continue;
    const outcome = await send(op);
    if (outcome.kind === "retry") {
      report.stopped = outcome;
      break;
    }
    if (outcome.kind === "decided" && outcome.result.outcome === "APPLIED") report.applied += 1;
    else {
      const conflict: Conflict = {
        opId: op.opId,
        taskId: op.taskId,
        taskTitle: taskTitle(op.taskId),
        kind: op.kind,
        message: outcome.kind === "final" ? outcome.message : (outcome.result.message ?? "Ce changement n'a pas été enregistré."),
        at: new Date().toISOString(),
      };
      await store.addConflict(conflict);
      report.rejected.push(conflict);
    }
    await store.remove(op.seq!);
  }
  return report;
}

/** The server's snapshot with the queued changes on top: what the agent sees. */
export function applyPending(tasks: readonly DayTask[], ops: readonly QueuedOp[]): DayTask[] {
  const byId = new Map(tasks.map((t) => [t.id, { ...t, pendingOps: 0, items: t.items.map((i) => ({ ...i, pendingPhotos: 0 })) }]));
  for (const op of ops) {
    const t = byId.get(op.taskId);
    if (!t) continue;
    t.pendingOps! += 1;
    switch (op.kind) {
      case "start":
        if (t.status === "TODO") t.status = "IN_PROGRESS";
        break;
      case "check": {
        const item = t.items.find((i) => i.id === op.itemId);
        if (item) item.checked = op.checked;
        break;
      }
      case "note":
        t.fieldNotes = op.notes || null;
        break;
      case "photo": {
        const item = t.items.find((i) => i.id === op.itemId);
        if (item) item.pendingPhotos! += 1;
        break;
      }
      case "complete":
        if (t.status === "IN_PROGRESS" && localBlockersCount(t) === 0) t.status = "DONE";
        break;
    }
  }
  return tasks.map((t) => byId.get(t.id)!);
}

/** What still stops the task from being finished, counting the photos waiting to be sent. */
export function localBlockers(task: DayTask): CompletionBlockers {
  return completionBlockers(task.items.map((i) => ({ id: i.id, label: i.label, requiresPhoto: i.requiresPhoto, checked: i.checked, photoCount: i.photos.length + (i.pendingPhotos ?? 0) })));
}

function localBlockersCount(task: DayTask): number {
  const b = localBlockers(task);
  return b.unchecked.length + b.missingPhotos.length;
}

/** Changes of `userId` still to send. */
export function pendingCount(ops: readonly QueuedOp[], userId: string): number {
  return ops.filter((o) => o.userId === userId).length;
}
