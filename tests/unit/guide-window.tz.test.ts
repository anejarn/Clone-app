import { describe, expect, it } from "vitest";
import { canRevealForTask } from "@/lib/guide/access";
import { accessState, accessWindow, guideLinkAlive } from "@/lib/guide/window";
import { DEFAULT_STAY_TIMES } from "@/lib/operations/schedule";

/**
 * When guests see their access codes (lib/guide/window.ts): from check-in time on arrival day to check-out time on
 * departure day, Marrakech time (UTC+1; UTC+0 during Ramadan: in 2027 from 07/02 03:00 to 14/03 02:00). Also run
 * under far-off server time zones (*.tz.test.ts): the result never depends on the server's zone.
 */

const TZ = "Africa/Casablanca";
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const at = (s: string) => new Date(s);
const win = (checkIn: string, checkOut: string, times = DEFAULT_STAY_TIMES) => accessWindow({ checkIn: day(checkIn), checkOut: day(checkOut) }, times, TZ);

describe("access window", () => {
  it("outside Ramadan: 15:00 local = 14:00 UTC on arrival, 11:00 local = 10:00 UTC on departure", () => {
    const w = win("2026-11-10", "2026-11-13");
    expect(w.opensAt.toISOString()).toBe("2026-11-10T14:00:00.000Z");
    expect(w.closesAt.toISOString()).toBe("2026-11-13T10:00:00.000Z");
    expect(accessState(w, at("2026-11-10T13:59:59.999Z"))).toBe("BEFORE");
    expect(accessState(w, at("2026-11-10T14:00:00.000Z"))).toBe("OPEN");
    expect(accessState(w, at("2026-11-12T23:00:00.000Z"))).toBe("OPEN");
    expect(accessState(w, at("2026-11-13T09:59:59.999Z"))).toBe("OPEN");
    expect(accessState(w, at("2026-11-13T10:00:00.000Z"))).toBe("AFTER");
  });

  it("during Ramadan (UTC+0): 15:00 local = 15:00 UTC", () => {
    const w = win("2027-02-20", "2027-02-23");
    expect(w.opensAt.toISOString()).toBe("2027-02-20T15:00:00.000Z");
    expect(w.closesAt.toISOString()).toBe("2027-02-23T11:00:00.000Z");
    expect(accessState(w, at("2027-02-20T14:30:00Z"))).toBe("BEFORE");
    expect(accessState(w, at("2027-02-23T10:30:00Z"))).toBe("OPEN");
  });

  it("across the changes of time: arriving before Ramadan, leaving during it, and the other way", () => {
    // Clocks go back on 07/02/2027 at 03:00: arrival at UTC+1, departure at UTC+0.
    const w1 = win("2027-02-05", "2027-02-08");
    expect(w1.opensAt.toISOString()).toBe("2027-02-05T14:00:00.000Z");
    expect(w1.closesAt.toISOString()).toBe("2027-02-08T11:00:00.000Z");
    // Arriving the day of the change: check-in at 15:00 is after it (UTC+0).
    expect(win("2027-02-07", "2027-02-09").opensAt.toISOString()).toBe("2027-02-07T15:00:00.000Z");
    // Clocks go forward on 14/03/2027 at 02:00: arrival at UTC+0, departure on that day at UTC+1.
    const w2 = win("2027-03-12", "2027-03-14");
    expect(w2.opensAt.toISOString()).toBe("2027-03-12T15:00:00.000Z");
    expect(w2.closesAt.toISOString()).toBe("2027-03-14T10:00:00.000Z");
  });

  it("uses the home's own times", () => {
    const w = win("2026-11-10", "2026-11-11", { checkInMinutes: 13 * 60 + 30, checkOutMinutes: 12 * 60 });
    expect(w.opensAt.toISOString()).toBe("2026-11-10T12:30:00.000Z");
    expect(w.closesAt.toISOString()).toBe("2026-11-11T11:00:00.000Z");
  });

  it("keeps the link working 30 days after check-out time, codes hidden", () => {
    const w = win("2026-11-10", "2026-11-13");
    expect(guideLinkAlive(w, at("2026-12-13T09:59:00Z"))).toBe(true);
    expect(guideLinkAlive(w, at("2026-12-13T10:00:00Z"))).toBe(false);
  });
});

describe("codes from a task's page", () => {
  const today = day("2026-11-10");
  const task = (over: Partial<{ assigneeId: string | null; scheduledDate: Date; status: string }> = {}) => ({ assigneeId: "agent1", scheduledDate: today, status: "TODO", ...over });
  const agent = { role: "AGENT", userId: "agent1" };

  it("an agent: their own task, today or tomorrow, not cancelled nor done", () => {
    expect(canRevealForTask(agent, task(), today)).toBe(true);
    expect(canRevealForTask(agent, task({ status: "IN_PROGRESS", scheduledDate: day("2026-11-11") }), today)).toBe(true);
    expect(canRevealForTask(agent, task({ scheduledDate: day("2026-11-12") }), today)).toBe(false);
    expect(canRevealForTask(agent, task({ scheduledDate: day("2026-11-09") }), today)).toBe(false);
    expect(canRevealForTask(agent, task({ assigneeId: "agent2" }), today)).toBe(false);
    expect(canRevealForTask(agent, task({ assigneeId: null }), today)).toBe(false);
    expect(canRevealForTask(agent, task({ status: "DONE" }), today)).toBe(false);
    expect(canRevealForTask(agent, task({ status: "CANCELLED" }), today)).toBe(false);
  });

  it("an associé: any task that isn't cancelled; other roles never", () => {
    const admin = { role: "ADMIN", userId: "a" };
    expect(canRevealForTask(admin, task({ assigneeId: null, scheduledDate: day("2026-12-01") }), today)).toBe(true);
    expect(canRevealForTask(admin, task({ status: "CANCELLED" }), today)).toBe(false);
    expect(canRevealForTask({ role: "OWNER", userId: "agent1" }, task(), today)).toBe(false);
    expect(canRevealForTask({ role: "GUEST", userId: "agent1" }, task(), today)).toBe(false);
  });
});
