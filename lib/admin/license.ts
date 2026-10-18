import { todayInTimeZone } from "@/lib/dates";
import { formatDate, pluralize } from "@/lib/format";
import { MARRAKECH_TIMEZONE } from "@/lib/neighbourhoods";

/**
 * Status of a listing's loi 80-14 authorisation (classement des établissements d'hébergement touristique), as the
 * back-office shows it. "Today" is the calendar date in Marrakech (Africa/Casablanca), never the server's date:
 * expiry dates are @db.Date values (UTC midnights), compared with todayInTimeZone().
 *
 * - MISSING: no number or no expiry date yet (application pending);
 * - EXPIRED: the expiry date is before today (the expiry day itself still counts as valid);
 * - EXPIRING: expires today or within LICENSE_ALERT_DAYS days (inclusive), the renewal alert;
 * - VALID: later than that.
 */

/** Authorisations are flagged this many days before they expire. */
export const LICENSE_ALERT_DAYS = 60;
const DAY = 86_400_000;

export type LicenseStatus = "MISSING" | "EXPIRED" | "EXPIRING" | "VALID";

export interface LicenseFields {
  licenseNumber: string | null;
  licenseExpiresAt: Date | null;
}

export interface LicenseState {
  status: LicenseStatus;
  /** Days from today to the expiry date (negative once expired); null when MISSING. */
  daysLeft: number | null;
}

export function licenseState(l: LicenseFields, today: Date): LicenseState {
  if (!l.licenseNumber || !l.licenseExpiresAt) return { status: "MISSING", daysLeft: null };
  const daysLeft = Math.round((l.licenseExpiresAt.getTime() - today.getTime()) / DAY);
  if (daysLeft < 0) return { status: "EXPIRED", daysLeft };
  if (daysLeft <= LICENSE_ALERT_DAYS) return { status: "EXPIRING", daysLeft };
  return { status: "VALID", daysLeft };
}

/** licenseState() for the date it is now in Marrakech. */
export function licenseStateNow(l: LicenseFields, now = Date.now()): LicenseState {
  return licenseState(l, todayInTimeZone(MARRAKECH_TIMEZONE, now));
}

/** Badge text for lists. */
export const LICENSE_BADGE: Record<LicenseStatus, string> = {
  MISSING: "Autorisation manquante",
  EXPIRED: "Autorisation expirée",
  EXPIRING: `Expire sous ${LICENSE_ALERT_DAYS} jours`,
  VALID: "Autorisation valide",
};

/** One sentence for the listing's page. */
export function licenseSentence(l: LicenseFields, state: LicenseState): string {
  if (state.status === "MISSING") return "Autorisation loi 80-14 manquante : renseignez le numéro et la date d'expiration dès réception.";
  const date = formatDate(l.licenseExpiresAt!);
  if (state.status === "EXPIRED") return `Autorisation loi 80-14 expirée le ${date}.`;
  const when = state.daysLeft === 0 ? "aujourd'hui" : `dans ${pluralize(state.daysLeft!, "jour", "jours")}`;
  if (state.status === "EXPIRING") return `Autorisation loi 80-14 à renouveler : elle expire le ${date} (${when}).`;
  return `Autorisation loi 80-14 valide jusqu'au ${date}.`;
}

/** Bounds of each status for database filters, given today in Marrakech: expiry < expiredBefore, ≤ expiringUntil. */
export function licenseBounds(today: Date) {
  return { expiredBefore: today, expiringUntil: new Date(today.getTime() + LICENSE_ALERT_DAYS * DAY) };
}
