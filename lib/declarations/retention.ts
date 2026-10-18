import { addNights } from "@/lib/pricing/engine";

/**
 * Retention of the travellers' identity data (Lot 5). The delay is a setting of the organization
 * (organizations.identityRetentionDays), counted in days from the stay's departure: the fiches and document scans of a
 * stay are deleted on its purge date (departure + delay) or after, by the purge job (lib/server/declarations/purge.ts,
 * `pnpm identity:purge`). The legal delay is NOT known here: the default is a placeholder that Sigma must confirm
 * with its lawyer (loi 09-08, CNDP, obligations of the DGSN). Nothing in the app asserts a legal value.
 */
export const DEFAULT_IDENTITY_RETENTION_DAYS = 365;
export const IDENTITY_RETENTION_LIMITS = { min: 1, max: 3650 };

export const RETENTION_WARNING =
  "Délai légal à confirmer par Sigma / avocat — loi 09-08, CNDP. La valeur par défaut (365 jours) n'est qu'une valeur provisoire.";

/** The first day (yyyy-MM-dd) on which a stay's identity data must be gone. */
export function purgeDate(checkOut: string, retentionDays: number): string {
  if (!Number.isInteger(retentionDays) || retentionDays < IDENTITY_RETENTION_LIMITS.min) throw new RangeError(`invalid retention: ${retentionDays}`);
  return addNights(checkOut, retentionDays);
}

/** Whether a stay's identity data is due for deletion on `today` (local date, yyyy-MM-dd). */
export function isDueForPurge(checkOut: string, retentionDays: number, today: string): boolean {
  return purgeDate(checkOut, retentionDays) <= today;
}

/** The latest departure date whose stays are due on `today`: departure ≤ today − delay. */
export function purgeCutoff(today: string, retentionDays: number): string {
  return addNights(today, -retentionDays);
}
