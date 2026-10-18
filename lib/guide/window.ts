import { localInstant, type StayTimes } from "@/lib/operations/schedule";

/**
 * When a guest may see the access codes and the Wi-Fi password of their stay: from the check-in time on the arrival
 * day to the check-out time on the departure day, in the home's time zone (Africa/Casablanca: UTC+1, UTC+0 during
 * Ramadan). Computed with the runtime's time zone rules (ICU, lib/operations/schedule.ts), never with Postgres'
 * (whose data for Morocco stops in September 2026 on Ubuntu 24.04). Pure: the clock is passed in.
 */

export type AccessState = "BEFORE" | "OPEN" | "AFTER";

export interface AccessWindow {
  opensAt: Date;
  closesAt: Date;
}

/** How long a guide link keeps working after the departure (codes hidden): then it answers « introuvable ». */
export const GUIDE_LINK_DAYS_AFTER_STAY = 30;

export function accessWindow(stay: { checkIn: Date; checkOut: Date }, times: StayTimes, timeZone: string): AccessWindow {
  return {
    opensAt: localInstant(stay.checkIn, times.checkInMinutes, timeZone),
    closesAt: localInstant(stay.checkOut, times.checkOutMinutes, timeZone),
  };
}

/** BEFORE until check-in time (excluded), OPEN until check-out time (excluded), AFTER from then on. */
export function accessState(window: AccessWindow, now: Date | number): AccessState {
  const t = typeof now === "number" ? now : now.getTime();
  if (t < window.opensAt.getTime()) return "BEFORE";
  if (t < window.closesAt.getTime()) return "OPEN";
  return "AFTER";
}

/** Whether the guide link still works at `now` (until GUIDE_LINK_DAYS_AFTER_STAY days after check-out time). */
export function guideLinkAlive(window: AccessWindow, now: Date | number): boolean {
  const t = typeof now === "number" ? now : now.getTime();
  return t < window.closesAt.getTime() + GUIDE_LINK_DAYS_AFTER_STAY * 86_400_000;
}
