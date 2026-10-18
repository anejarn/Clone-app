import { idb } from "./idb";
import { classifyResponse, type Conflict, type DaySnapshot, type QueuedOp, type QueueStore, type SendOutcome } from "./queue";

/**
 * « Ma journée »'s data on the phone, in IndexedDB (lib/offline/idb.ts): the last snapshot of the day, the changes
 * waiting to be sent and the refused ones. Browser only.
 */

export const OPERATIONS_URL = "/api/admin/journee/operations";
export const DAY_URL = "/api/admin/journee";

type KvDay = { key: "day" } & DaySnapshot;

export async function loadSnapshot(): Promise<DaySnapshot | null> {
  const row = await idb.get<KvDay>("kv", "day");
  if (!row) return null;
  const { key: _key, ...snapshot } = row;
  void _key;
  return snapshot;
}

export async function saveSnapshot(s: DaySnapshot): Promise<void> {
  await idb.put("kv", { key: "day", ...s });
}

export async function listOps(): Promise<QueuedOp[]> {
  return (await idb.all<QueuedOp>("ops")).sort((a, b) => a.seq! - b.seq!);
}

export async function enqueue(op: QueuedOp): Promise<void> {
  await idb.put("ops", op);
}

export async function listConflicts(): Promise<Conflict[]> {
  return (await idb.all<Conflict>("conflicts")).sort((a, b) => a.at.localeCompare(b.at));
}

export async function dismissConflicts(): Promise<void> {
  await idb.clear("conflicts");
}

/** Forgets everything of another person (an earlier session on this phone): their snapshot, queue and conflicts. */
export async function forgetOtherUsers(userId: string): Promise<void> {
  const snap = await loadSnapshot();
  if (snap && snap.user.id !== userId) {
    await idb.clear("kv");
    await idb.clear("conflicts");
  }
  for (const op of await listOps()) if (op.userId !== userId) await idb.delete("ops", op.seq!);
}

export const idbQueueStore: QueueStore = {
  list: listOps,
  remove: (seq) => idb.delete("ops", seq),
  addConflict: (c) => idb.put("conflicts", c).then(() => undefined),
};

/** Sends one queued change to the server (multipart: the operation, and its photo). */
export async function sendOp(op: QueuedOp): Promise<SendOutcome> {
  const { seq: _seq, userId: _userId, queuedAt: _queuedAt, photo, ...wire } = op;
  void _seq;
  void _userId;
  void _queuedAt;
  const form = new FormData();
  form.set("op", JSON.stringify(wire));
  if (photo) form.set("photo", photo, "photo.jpg");
  let res: Response;
  try {
    res = await fetch(OPERATIONS_URL, { method: "POST", body: form, credentials: "same-origin", cache: "no-store" });
  } catch {
    return classifyResponse(0, null);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // An HTML error page, a proxy's answer…
  }
  return classifyResponse(res.status, body);
}

/** The day from the server, or null when it can't be had now (offline, signed out…). */
export async function fetchDay(): Promise<{ ok: true; day: DaySnapshot } | { ok: false; status: number }> {
  try {
    const res = await fetch(DAY_URL, { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, day: (await res.json()) as DaySnapshot };
  } catch {
    return { ok: false, status: 0 };
  }
}
