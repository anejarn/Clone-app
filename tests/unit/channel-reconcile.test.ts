import { describe, expect, it } from "vitest";
import { planSync, type PlanInput } from "@/lib/channels/reconcile";
import type { ChannelEvent } from "@/lib/channels/types";

/** What one read of a feed changes (lib/channels/reconcile.ts), without a database. */

const D = (s: string) => new Date(`${s}T00:00:00Z`);
const ev = (ref: string, ci: string, co: string, o: Partial<ChannelEvent> = {}): ChannelEvent => ({
  ref,
  uid: ref,
  checkIn: D(ci),
  checkOut: D(co),
  kind: "reservation",
  ambiguous: false,
  cancelled: false,
  ownExport: false,
  ...o,
});
const base = (o: Partial<PlanInput> = {}): PlanInput => ({
  today: D("2027-01-01"),
  source: "AIRBNB",
  events: [],
  own: [],
  adoptable: [],
  takenRefs: new Set(),
  others: [],
  exported: [],
  openConflicts: [],
  dismissed: [],
  ...o,
});
const types = (p: ReturnType<typeof planSync>) => p.actions.map((a) => a.type);

describe("planSync", () => {
  it("new events are created; the same file again changes nothing", () => {
    const p = planSync(base({ events: [ev("A", "2027-01-10", "2027-01-12"), ev("B", "2027-01-12", "2027-01-15")] }));
    expect(types(p)).toEqual(["create", "create"]);
    expect(p.counts).toEqual({ created: 2, updated: 0, cancelled: 0, conflicts: 0 });
    const again = planSync(
      base({
        events: [ev("A", "2027-01-10", "2027-01-12"), ev("B", "2027-01-12", "2027-01-15")],
        own: [
          { id: "a", ref: "A", checkIn: D("2027-01-10"), checkOut: D("2027-01-12"), status: "CONFIRMED", block: false },
          { id: "b", ref: "B", checkIn: D("2027-01-12"), checkOut: D("2027-01-15"), status: "CONFIRMED", block: false },
        ],
      }),
    );
    expect(again.actions).toEqual([]);
    expect(again.unchanged).toBe(2);
  });

  it("new dates re-date; a vanished future event cancels; a started stay is kept", () => {
    const p = planSync(
      base({
        events: [ev("A", "2027-01-11", "2027-01-14")],
        own: [
          { id: "a", ref: "A", checkIn: D("2027-01-10"), checkOut: D("2027-01-12"), status: "CONFIRMED", block: false },
          { id: "b", ref: "B", checkIn: D("2027-02-01"), checkOut: D("2027-02-03"), status: "CONFIRMED", block: false },
          { id: "c", ref: "C", checkIn: D("2026-12-30"), checkOut: D("2027-01-02"), status: "CONFIRMED", block: false },
        ],
      }),
    );
    expect(p.actions).toEqual([
      { type: "cancel", bookingId: "b" },
      { type: "update", bookingId: "a", ev: expect.objectContaining({ ref: "A" }), from: { checkIn: D("2027-01-10"), checkOut: D("2027-01-12") } },
    ]);
    expect(p.kept).toBe(1);
  });

  it("an overlap with another booking is a conflict, both ways round within one file", () => {
    const p = planSync(
      base({
        events: [ev("A", "2027-01-10", "2027-01-13"), ev("B", "2027-01-12", "2027-01-14"), ev("C", "2027-01-20", "2027-01-22")],
        others: [{ id: "direct", source: "DIRECT", ref: null, checkIn: D("2027-01-21"), checkOut: D("2027-01-25") }],
      }),
    );
    expect(types(p)).toEqual(["create", "conflict", "conflict"]);
    const [, b, c] = p.actions;
    expect(b).toMatchObject({ ev: { ref: "B" }, blocker: { id: "new:A" } });
    expect(c).toMatchObject({ ev: { ref: "C" }, blocker: { id: "direct", source: "DIRECT" } });
    expect(p.counts.conflicts).toBe(2);
  });

  it("a re-dated booking moved onto taken nights keeps its dates and opens a conflict naming it", () => {
    const p = planSync(
      base({
        events: [ev("A", "2027-01-20", "2027-01-23")],
        own: [{ id: "a", ref: "A", checkIn: D("2027-01-10"), checkOut: D("2027-01-12"), status: "CONFIRMED", block: false }],
        others: [{ id: "x", source: "BOOKING", ref: "123", checkIn: D("2027-01-22"), checkOut: D("2027-01-24") }],
      }),
    );
    expect(p.actions).toEqual([expect.objectContaining({ type: "conflict", ownBookingId: "a", existingConflictId: null })]);
  });

  it("an open conflict is refreshed while blocked, resolved FREED or EVENT_GONE otherwise", () => {
    const openConflicts = [{ id: "k1", ref: "A", checkIn: D("2027-01-10"), checkOut: D("2027-01-12") }, { id: "k2", ref: "Z", checkIn: D("2027-03-01"), checkOut: D("2027-03-02") }];
    const blocked = planSync(base({ events: [ev("A", "2027-01-10", "2027-01-12")], openConflicts, others: [{ id: "x", source: "DIRECT", ref: null, checkIn: D("2027-01-11"), checkOut: D("2027-01-13") }] }));
    expect(blocked.actions).toEqual([{ type: "resolve", conflictId: "k2", resolution: "EVENT_GONE" }, expect.objectContaining({ type: "conflict", existingConflictId: "k1" })]);
    expect(blocked.counts.conflicts).toBe(0);
    const freed = planSync(base({ events: [ev("A", "2027-01-10", "2027-01-12")], openConflicts: openConflicts.slice(0, 1) }));
    expect(types(freed)).toEqual(["resolve", "create"]);
    expect(freed.actions[0]).toMatchObject({ resolution: "FREED" });
  });

  it("a dismissed conflict on the same nights stays dismissed; new nights reopen it", () => {
    const others = [{ id: "x", source: "DIRECT" as const, ref: null, checkIn: D("2027-01-11"), checkOut: D("2027-01-13") }];
    const dismissed = [{ ref: "A", checkIn: D("2027-01-10"), checkOut: D("2027-01-12") }];
    expect(planSync(base({ events: [ev("A", "2027-01-10", "2027-01-12")], others, dismissed })).ignored).toEqual([{ ref: "A", reason: "DISMISSED" }]);
    expect(types(planSync(base({ events: [ev("A", "2027-01-10", "2027-01-13")], others, dismissed })))).toEqual(["conflict"]);
  });

  it("ignores past, too far, cancelled, echoes and refs used elsewhere", () => {
    const p = planSync(
      base({
        events: [
          ev("P", "2026-12-20", "2027-01-01"),
          ev("F", "2029-06-01", "2029-06-03"),
          ev("X", "2027-01-10", "2027-01-12", { cancelled: true }),
          ev("E", "2027-01-20", "2027-01-23", { kind: "block", ambiguous: true }),
          ev("S", "2027-02-01", "2027-02-02", { ownExport: true }),
          ev("T", "2027-03-01", "2027-03-02"),
        ],
        exported: [{ start: D("2027-01-20"), end: D("2027-01-23") }],
        others: [{ id: "d", source: "DIRECT", ref: null, checkIn: D("2027-01-20"), checkOut: D("2027-01-23") }],
        takenRefs: new Set(["T"]),
      }),
    );
    expect(p.actions).toEqual([]);
    expect(p.ignored.map((i) => i.reason)).toEqual(["PAST", "TOO_FAR", "CANCELLED", "ECHO", "ECHO", "REF_ELSEWHERE"]);
  });

  it("a non-echo block is imported as a block; a reservation on exported nights isn't treated as an echo", () => {
    const p = planSync(
      base({
        events: [ev("B", "2027-01-05", "2027-01-07", { kind: "block", ambiguous: true }), ev("R", "2027-01-20", "2027-01-23")],
        exported: [{ start: D("2027-01-20"), end: D("2027-01-23") }],
        others: [{ id: "d", source: "DIRECT", ref: null, checkIn: D("2027-01-20"), checkOut: D("2027-01-23") }],
      }),
    );
    expect(p.actions).toEqual([{ type: "create", ev: expect.objectContaining({ ref: "B", kind: "block" }) }, expect.objectContaining({ type: "conflict", ev: expect.objectContaining({ ref: "R" }) })]);
  });

  it("adopts a booking typed by hand with the platform's code; reactivates a cancelled own booking", () => {
    const p = planSync(
      base({
        events: [ev("HMTEST0001", "2027-01-10", "2027-01-12"), ev("R", "2027-02-10", "2027-02-12")],
        adoptable: [{ id: "typed", ref: "HMTEST0001", checkIn: D("2027-01-10"), checkOut: D("2027-01-12"), status: "CONFIRMED", block: false }],
        own: [{ id: "old", ref: "R", checkIn: D("2027-02-10"), checkOut: D("2027-02-12"), status: "CANCELLED", block: false }],
        others: [{ id: "typed", source: "AIRBNB", ref: "HMTEST0001", checkIn: D("2027-01-10"), checkOut: D("2027-01-12") }],
      }),
    );
    expect(types(p)).toEqual(["adopt", "reactivate"]);
  });

  it("refuses an empty file that would cancel several bookings", () => {
    const own = ["a", "b"].map((id, i) => ({ id, ref: id, checkIn: D(`2027-0${i + 2}-01`), checkOut: D(`2027-0${i + 2}-03`), status: "CONFIRMED" as const, block: false }));
    expect(planSync(base({ own })).suspectEmpty).toBe(true);
    expect(planSync(base({ own: own.slice(0, 1) })).actions).toEqual([{ type: "cancel", bookingId: "a" }]);
  });
});
