import { describe, expect, it } from "vitest";
import { parseManualTaskForm, parseTaskTimeForm } from "@/lib/admin/task-form";
import { blockersMessage, canComplete, completionBlockers, DEFAULT_CHECKLISTS, templateItems, type ChecklistState } from "@/lib/operations/checklist";

const item = (label: string, over: Partial<ChecklistState> = {}): ChecklistState => ({ id: label, label, requiresPhoto: false, checked: true, photoCount: 0, ...over });

describe("completion rule", () => {
  it("a task is done only with every item ticked and every required photo", () => {
    expect(canComplete([item("Sols"), item("Salle de bain", { requiresPhoto: true, photoCount: 1 })])).toBe(true);
    expect(canComplete([])).toBe(true);
    expect(canComplete([item("Sols", { checked: false })])).toBe(false);
    // Ticked, but the photo is missing.
    expect(canComplete([item("Salle de bain", { requiresPhoto: true })])).toBe(false);
    // A photo on an item that doesn't require one changes nothing.
    expect(canComplete([item("Sols", { photoCount: 2, checked: false })])).toBe(false);
  });

  it("says what is missing, in French", () => {
    const b = completionBlockers([item("Sols", { checked: false }), item("Cuisine", { requiresPhoto: true, checked: false }), item("Salle de bain", { requiresPhoto: true })]);
    expect(b).toEqual({ unchecked: ["Sols", "Cuisine"], missingPhotos: ["Cuisine", "Salle de bain"] });
    expect(blockersMessage(b)).toBe("Il reste à cocher : Sols, Cuisine. Photos obligatoires manquantes : Cuisine, Salle de bain.");
    expect(blockersMessage({ unchecked: [], missingPhotos: ["Cuisine"] })).toBe("Photo obligatoire manquante : Cuisine.");
  });
});

describe("templates", () => {
  it("defaults in French, with required photos for cleaning, linen and welcome", () => {
    expect(DEFAULT_CHECKLISTS.CLEANING.map((i) => i.label)).toContain("Photos de chaque pièce");
    expect(DEFAULT_CHECKLISTS.CHECKIN.map((i) => i.label)).toEqual(expect.arrayContaining(["Remise des clés", "Explication du Wi-Fi (réseau et mot de passe)"]));
    for (const t of ["CLEANING", "LINEN", "CHECKIN"] as const) expect(DEFAULT_CHECKLISTS[t].some((i) => i.requiresPhoto), t).toBe(true);
  });

  it("reads stored JSON defensively", () => {
    expect(templateItems([{ label: " Terrasse ", requiresPhoto: true }, { label: "" }, { nope: 1 }, "x"], "OTHER")).toEqual([{ label: "Terrasse", requiresPhoto: true }]);
    expect(templateItems({ not: "a list" }, "LINEN")).toEqual(DEFAULT_CHECKLISTS.LINEN);
    expect(templateItems([], "CHECKIN")).toEqual(DEFAULT_CHECKLISTS.CHECKIN);
  });
});

describe("task forms", () => {
  it("a new day and times", () => {
    expect(parseTaskTimeForm({ day: "2027-03-01", start: "10:00", end: "12:30" })).toEqual({ ok: true, input: { day: new Date("2027-03-01T00:00:00Z"), start: 600, end: 750 } });
    expect(parseTaskTimeForm({ day: "2027-02-30", start: "10:00", end: "12:00" })).toMatchObject({ ok: false, fieldErrors: { day: expect.any(String) } });
    expect(parseTaskTimeForm({ day: "2027-03-01", start: "12:00", end: "10:00" })).toMatchObject({ ok: false, fieldErrors: { end: "Fin : après l'heure de début" } });
  });

  it("a manual task: a title for « Autre », a well-formed home and agent", () => {
    const base = { listingId: "1111", type: "CLEANING", day: "2027-03-01", start: "10:00", end: "12:00", title: "", notes: "Après le séjour du propriétaire", assigneeId: "" };
    expect(parseManualTaskForm(base)).toMatchObject({ ok: true, input: { type: "CLEANING", assigneeId: null, notes: "Après le séjour du propriétaire" } });
    expect(parseManualTaskForm({ ...base, type: "OTHER" })).toMatchObject({ ok: false, fieldErrors: { title: expect.any(String) } });
    expect(parseManualTaskForm({ ...base, type: "OTHER", title: "Courses" })).toMatchObject({ ok: true });
    expect(parseManualTaskForm({ ...base, type: "PARTY" })).toMatchObject({ ok: false, fieldErrors: { type: expect.any(String) } });
    expect(parseManualTaskForm({ ...base, listingId: "../x" })).toMatchObject({ ok: false, fieldErrors: { listingId: expect.any(String) } });
    expect(parseManualTaskForm({ ...base, assigneeId: "a b" })).toMatchObject({ ok: false, fieldErrors: { assigneeId: expect.any(String) } });
    expect(parseManualTaskForm({ ...base, notes: "x".repeat(2001) })).toMatchObject({ ok: false, fieldErrors: { notes: expect.any(String) } });
  });
});
