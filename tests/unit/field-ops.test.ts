import { describe, expect, it } from "vitest";
import { decideFieldOp, FIELD_OP_KINDS, fieldOpSchema, newOpId, OP_ID_RE, plausibleClientTime, REJECTION_MESSAGE } from "@/lib/operations/field-ops";
import type { TaskState } from "@/lib/operations/labels";

/** « Ma journée »: the operations a phone sends, their ids, and how the server settles conflicts (the server wins). */

describe("operation ids", () => {
  it("are random UUIDs the server accepts, never twice the same", () => {
    const ids = new Set(Array.from({ length: 500 }, newOpId));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(OP_ID_RE);
  });

  it("refuses ids too short, too long or with other characters", () => {
    for (const bad of ["", "abc", "x".repeat(65), "abc def gh", "../../etc", "é".repeat(10)]) expect(OP_ID_RE.test(bad), bad).toBe(false);
  });
});

describe("fieldOpSchema", () => {
  const base = { opId: "7d0f7a8e-2b4c-4d7a-9a51-1f0e2a3b4c5d", taskId: "task_1", at: "2026-10-18T09:15:00.000Z" };

  it("reads each kind with its own fields", () => {
    expect(fieldOpSchema.parse({ ...base, kind: "start" })).toEqual({ ...base, kind: "start" });
    expect(fieldOpSchema.parse({ ...base, kind: "check", itemId: "item_1", checked: false })).toMatchObject({ checked: false });
    expect(fieldOpSchema.parse({ ...base, kind: "note", notes: "Robinet qui goutte\nà surveiller" })).toMatchObject({ notes: "Robinet qui goutte\nà surveiller" });
    expect(fieldOpSchema.parse({ ...base, kind: "photo", itemId: "item_1" })).toMatchObject({ kind: "photo" });
    expect(fieldOpSchema.parse({ opId: base.opId, taskId: "t", kind: "complete" })).toMatchObject({ kind: "complete" });
  });

  it("refuses unknown kinds, missing fields, bad ids, control characters and long notes", () => {
    for (const bad of [
      { ...base, kind: "delete" },
      { ...base, kind: "check", itemId: "item_1" },
      { ...base, kind: "check", itemId: "../x", checked: true },
      { ...base, opId: "short", kind: "start" },
      { ...base, taskId: "a b", kind: "start" },
      { ...base, kind: "note", notes: "a\u0000b" },
      { ...base, kind: "note", notes: "x".repeat(2001) },
      { ...base, at: "hier", kind: "start" },
    ]) {
      expect(fieldOpSchema.safeParse(bad).success, JSON.stringify(bad).slice(0, 60)).toBe(false);
    }
  });
});

describe("decideFieldOp: the server wins", () => {
  const states: (TaskState | null)[] = [null, "TODO", "IN_PROGRESS", "DONE", "CANCELLED"];

  it("refuses everything on a task taken from the agent or cancelled meanwhile", () => {
    for (const kind of FIELD_OP_KINDS) {
      expect(decideFieldOp(kind, null)).toEqual({ action: "reject", code: "TASK_GONE" });
      expect(decideFieldOp(kind, "CANCELLED")).toEqual({ action: "reject", code: "TASK_CANCELLED" });
    }
  });

  it("gives the full table", () => {
    const table = Object.fromEntries(
      FIELD_OP_KINDS.map((k) => [k, states.slice(1, 4).map((s) => { const d = decideFieldOp(k, s); return d.action === "reject" ? d.code : d.action; })]),
    );
    // Columns: TODO, IN_PROGRESS, DONE.
    expect(table).toEqual({
      start: ["apply", "noop", "noop"],
      check: ["TASK_NOT_STARTED", "apply", "TASK_DONE"],
      note: ["apply", "apply", "apply"],
      photo: ["TASK_NOT_STARTED", "apply", "TASK_DONE"],
      complete: ["TASK_NOT_STARTED", "apply", "noop"],
    });
  });

  it("has a French message for every refusal", () => {
    for (const m of Object.values(REJECTION_MESSAGE)) expect(m).toMatch(/^[A-ZÀ-Ý]/);
    expect(REJECTION_MESSAGE.TASK_GONE).toContain("plus confiée");
    expect(REJECTION_MESSAGE.TASK_CANCELLED).toContain("annulée");
  });
});

describe("plausibleClientTime", () => {
  const now = Date.parse("2026-10-18T12:00:00Z");
  it("keeps the phone's time of a change made offline, within limits", () => {
    expect(plausibleClientTime("2026-10-18T09:00:00Z", now)?.toISOString()).toBe("2026-10-18T09:00:00.000Z");
    expect(plausibleClientTime("2026-10-18T12:03:00Z", now)).not.toBeNull();
    expect(plausibleClientTime("2026-10-18T12:30:00Z", now)).toBeNull();
    expect(plausibleClientTime("2026-09-01T12:00:00Z", now)).toBeNull();
    expect(plausibleClientTime(undefined, now)).toBeNull();
    expect(plausibleClientTime("n'importe quoi", now)).toBeNull();
  });
});
