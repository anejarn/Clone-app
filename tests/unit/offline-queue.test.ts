import { describe, expect, it } from "vitest";
import { applyPending, classifyResponse, flushQueue, localBlockers, pendingCount, RETRY_MESSAGE, type Conflict, type DayTask, type QueuedOp, type QueueStore, type SendOutcome } from "@/lib/offline/queue";

/** « Ma journée » on the phone: the queue of changes, how it is sent, and what the agent sees meanwhile. */

function memoryStore(ops: QueuedOp[]): QueueStore & { ops: QueuedOp[]; conflicts: Conflict[] } {
  const s = {
    ops: ops.map((o, i) => ({ ...o, seq: i + 1 })),
    conflicts: [] as Conflict[],
    list: async () => [...s.ops].sort((a, b) => a.seq! - b.seq!),
    remove: async (seq: number) => {
      s.ops = s.ops.filter((o) => o.seq !== seq);
    },
    addConflict: async (c: Conflict) => {
      s.conflicts.push(c);
    },
  };
  return s;
}

const me = "agent_1";
let n = 0;
const op = (o: Partial<QueuedOp> & Pick<QueuedOp, "kind">): QueuedOp =>
  ({ opId: `op-000000${(n += 1)}`, taskId: "t1", userId: me, queuedAt: "2026-10-18T09:00:00Z", ...o }) as QueuedOp;
const applied = (opId: string): SendOutcome => ({ kind: "decided", result: { opId, outcome: "APPLIED", replayed: false } });

describe("flushQueue", () => {
  it("sends the agent's changes in order and empties the queue", async () => {
    const store = memoryStore([op({ kind: "start" }), op({ kind: "check", itemId: "i1", checked: true }), op({ kind: "complete" })]);
    const sent: string[] = [];
    const report = await flushQueue(store, me, async (o) => (sent.push(o.kind), applied(o.opId)));
    expect(sent).toEqual(["start", "check", "complete"]);
    expect(report).toEqual({ applied: 3, rejected: [], stopped: null });
    expect(store.ops).toEqual([]);
  });

  it("stops at the first change that must wait, keeps it and everything after it, in order", async () => {
    const store = memoryStore([op({ kind: "start" }), op({ kind: "check", itemId: "i1", checked: true }), op({ kind: "complete" })]);
    let calls = 0;
    const report = await flushQueue(store, me, async (o) => (++calls === 2 ? { kind: "retry", reason: "offline", message: RETRY_MESSAGE.offline } : applied(o.opId)));
    expect(report.applied).toBe(1);
    expect(report.stopped).toMatchObject({ reason: "offline" });
    expect(store.ops.map((o) => o.kind)).toEqual(["check", "complete"]);
    // Back online: resumes from where it stopped.
    const again = await flushQueue(store, me, async (o) => applied(o.opId));
    expect(again.applied).toBe(2);
    expect(store.ops).toEqual([]);
  });

  it("a refused change leaves the queue as a conflict with the server's message; the next ones are still sent", async () => {
    const store = memoryStore([op({ kind: "check", itemId: "i1", checked: true, taskId: "gone" }), op({ kind: "start", taskId: "t2" })]);
    const report = await flushQueue(
      store,
      me,
      async (o) =>
        o.taskId === "gone"
          ? { kind: "decided", result: { opId: o.opId, outcome: "REJECTED", code: "TASK_GONE", message: "Cette tâche ne vous est plus confiée.", replayed: false } }
          : applied(o.opId),
      (id) => (id === "gone" ? "Ménage · Riad" : "?"),
    );
    expect(report.applied).toBe(1);
    expect(report.rejected).toMatchObject([{ taskId: "gone", taskTitle: "Ménage · Riad", kind: "check", message: "Cette tâche ne vous est plus confiée." }]);
    expect(store.conflicts).toHaveLength(1);
    expect(store.ops).toEqual([]);
  });

  it("drops a change the server can't read, as a conflict, instead of retrying it forever", async () => {
    const store = memoryStore([op({ kind: "note", notes: "x" })]);
    const report = await flushQueue(store, me, async () => ({ kind: "final", message: "Remarques : caractères non autorisés" }));
    expect(report.rejected[0].message).toBe("Remarques : caractères non autorisés");
    expect(store.ops).toEqual([]);
  });

  it("never sends another person's changes (an earlier session on the same phone)", async () => {
    const store = memoryStore([op({ kind: "start", userId: "someone_else" }), op({ kind: "start" })]);
    const sent: string[] = [];
    await flushQueue(store, me, async (o) => (sent.push(o.userId), applied(o.opId)));
    expect(sent).toEqual([me]);
    expect(store.ops.map((o) => o.userId)).toEqual(["someone_else"]);
  });

  it("a retry sends the same operation id again (the server answers it once)", async () => {
    const store = memoryStore([op({ kind: "complete" })]);
    const ids: string[] = [];
    await flushQueue(store, me, async (o) => (ids.push(o.opId), { kind: "retry", reason: "server", message: RETRY_MESSAGE.server }));
    await flushQueue(store, me, async (o) => (ids.push(o.opId), applied(o.opId)));
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });
});

describe("classifyResponse", () => {
  it("maps the server's answers", () => {
    const result = { opId: "x", outcome: "APPLIED", replayed: true };
    expect(classifyResponse(200, { result })).toEqual({ kind: "decided", result });
    expect(classifyResponse(0, null)).toMatchObject({ kind: "retry", reason: "offline" });
    expect(classifyResponse(401, { error: { code: "UNAUTHENTICATED" } })).toMatchObject({ kind: "retry", reason: "auth" });
    expect(classifyResponse(403, { error: { code: "TWO_FACTOR_REQUIRED" } })).toMatchObject({ kind: "retry", reason: "auth" });
    expect(classifyResponse(400, { error: { message: "kind : invalide" } })).toEqual({ kind: "final", message: "kind : invalide" });
    expect(classifyResponse(413, null)).toMatchObject({ kind: "final" });
    for (const status of [500, 502, 503, 429]) expect(classifyResponse(status, null)).toMatchObject({ kind: "retry", reason: "server" });
    // A 200 that isn't the API's (a captive portal…): try again later.
    expect(classifyResponse(200, "<html>")).toMatchObject({ kind: "retry", reason: "server" });
  });
});

const task = (over: Partial<DayTask> = {}): DayTask => ({
  id: "t1",
  type: "CLEANING",
  status: "TODO",
  title: "Ménage après départ",
  listingTitle: "Riad",
  address: "Derb 1",
  placeName: "Médina",
  scheduledDate: "2026-10-18",
  startTime: "11:00",
  endTime: "15:00",
  turnover: false,
  notes: null,
  fieldNotes: null,
  booking: null,
  items: [
    { id: "i1", label: "Sols", requiresPhoto: false, checked: false, photos: [] },
    { id: "i2", label: "Salle de bain", requiresPhoto: true, checked: false, photos: [] },
  ],
  ...over,
});

describe("applyPending: what the agent sees before the changes are sent", () => {
  it("applies start, ticks, notes and photos on top of the server's snapshot, without changing it", () => {
    const snapshot = [task()];
    const frozen = JSON.stringify(snapshot);
    const [t] = applyPending(snapshot, [
      op({ kind: "start" }),
      op({ kind: "check", itemId: "i1", checked: true }),
      op({ kind: "check", itemId: "i2", checked: true }),
      op({ kind: "check", itemId: "i2", checked: false }),
      op({ kind: "note", notes: "Clé difficile à tourner" }),
      op({ kind: "photo", itemId: "i2" }),
    ]);
    expect(t.status).toBe("IN_PROGRESS");
    expect(t.items.map((i) => i.checked)).toEqual([true, false]);
    expect(t.items[1].pendingPhotos).toBe(1);
    expect(t.fieldNotes).toBe("Clé difficile à tourner");
    expect(t.pendingOps).toBe(6);
    expect(JSON.stringify(snapshot)).toBe(frozen);
  });

  it("shows a task done only if the check-list allows it (queued photos count)", () => {
    const ticks = [op({ kind: "start" }), op({ kind: "check", itemId: "i1", checked: true }), op({ kind: "check", itemId: "i2", checked: true })];
    expect(applyPending([task()], [...ticks, op({ kind: "complete" })])[0].status).toBe("IN_PROGRESS");
    expect(applyPending([task()], [...ticks, op({ kind: "photo", itemId: "i2" }), op({ kind: "complete" })])[0].status).toBe("DONE");
  });

  it("ignores changes of tasks no longer in the day (they will come back as conflicts)", () => {
    expect(applyPending([task()], [op({ kind: "start", taskId: "other" })])[0]).toMatchObject({ status: "TODO", pendingOps: 0 });
  });

  it("localBlockers counts server and queued photos; pendingCount counts the agent's changes", () => {
    const t = task({ status: "IN_PROGRESS", items: [{ id: "i2", label: "Salle de bain", requiresPhoto: true, checked: true, photos: [], pendingPhotos: 1 }] });
    expect(localBlockers(t)).toEqual({ unchecked: [], missingPhotos: [] });
    expect(localBlockers({ ...t, items: [{ ...t.items[0], pendingPhotos: 0 }] }).missingPhotos).toEqual(["Salle de bain"]);
    expect(pendingCount([op({ kind: "start" }), op({ kind: "start", userId: "x" })], me)).toBe(1);
  });
});
