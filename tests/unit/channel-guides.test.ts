import { describe, expect, it } from "vitest";
import { PLATFORM_SOURCES } from "@/lib/admin/booking-sources";
import { checklist, GUIDE_CAVEAT, isManualTick, parseTicks, PLATFORM_GUIDES } from "@/lib/channels/guides";

/** The step-by-step connection guide of each platform and its checklist (lib/channels/guides.ts). */

describe("connection guides", () => {
  it("every platform has export, import and rules steps, in French, without menu paths given as facts", () => {
    for (const s of PLATFORM_SOURCES) {
      const g = PLATFORM_GUIDES[s];
      expect(g.exportSteps.length, s).toBeGreaterThan(0);
      expect(g.importSteps.length, s).toBeGreaterThan(0);
      expect(g.rulesSteps.join(" "), s).toMatch(/délai de préparation/);
      // Generic wording: no « Menu → Sous-menu » path of the platform (Sigma's own pages may be named).
      expect(JSON.stringify(g).replaceAll("Synchronisation → Prix à reporter", ""), s).not.toContain("→");
    }
    expect(GUIDE_CAVEAT).toMatch(/À vérifier sur l'interface actuelle de la plateforme/);
  });

  it("the checklist: import and export seen by Sigma, the rest ticked by hand", () => {
    const fmt = (iso: string) => iso.slice(0, 10);
    const none = checklist({ importSet: false, exportLastReadAt: null, lastSuccessAt: null, ticks: {} }, fmt);
    expect(none.map((c) => [c.key, c.done, c.manual])).toEqual([
      ["importSet", false, false],
      ["exportPasted", false, true],
      ["rulesSet", false, true],
      ["testDone", false, true],
    ]);
    const all = checklist({ importSet: true, exportLastReadAt: "2027-01-02T10:00:00.000Z", lastSuccessAt: "2027-01-02T11:00:00.000Z", ticks: { rulesSet: "2027-01-02T09:00:00.000Z", testDone: "2027-01-02T12:00:00.000Z" } }, fmt);
    expect(all.every((c) => c.done)).toBe(true);
    expect(all.find((c) => c.key === "exportPasted")).toMatchObject({ how: "auto", detail: "lu par la plateforme le 2027-01-02" });
    expect(all.find((c) => c.key === "rulesSet")).toMatchObject({ how: "manual" });
  });

  it("ticks: only the known steps, with valid instants", () => {
    expect(parseTicks({ rulesSet: "2027-01-02T09:00:00.000Z", importSet: "2027-01-02T09:00:00.000Z", testDone: "nope", other: 1 })).toEqual({ rulesSet: "2027-01-02T09:00:00.000Z" });
    expect(parseTicks(null)).toEqual({});
    expect(parseTicks([1])).toEqual({});
    expect(isManualTick("testDone")).toBe(true);
    expect(isManualTick("importSet")).toBe(false);
  });
});
