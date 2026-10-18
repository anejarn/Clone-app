import "server-only";
import { LICENSE_ALERT_DAYS } from "@/lib/admin/license";
import { todayInTimeZone } from "@/lib/dates";
import { MARRAKECH_TIMEZONE } from "@/lib/neighbourhoods";
import { db } from "../db";
import { taskCounts } from "../operations/tasks";

/** Authorisations loi 80-14 are flagged this many days before they expire (lib/admin/license.ts). */
export { LICENSE_ALERT_DAYS };
const DAY = 86_400_000;

export interface DashboardCounts {
  /** Homes (biens) of the organization; experiences are not properties. */
  listings: number;
  /** Confirmed stays of guests (direct and platform) arriving today or later; owner blocks are not reservations. */
  upcomingBookings: number;
  /** Homes whose loi 80-14 authorisation is already expired or expires within LICENSE_ALERT_DAYS. */
  licensesExpiring: number;
  /** Homes still waiting for their authorisation (no number yet). */
  licensesPending: number;
  /** Field tasks of today (not cancelled). */
  tasksToday: number;
  /** Open field tasks (à faire, en cours) from today on that nobody is assigned to. */
  tasksUnassigned: number;
}

/** Back-office dashboard counts, for one organization. "Today" is the date in Marrakech unless given. */
export async function dashboardCounts(organizationId: string, today = todayInTimeZone(MARRAKECH_TIMEZONE)): Promise<DashboardCounts> {
  const alertLimit = new Date(today.getTime() + LICENSE_ALERT_DAYS * DAY);
  const homes = { organizationId, category: "HOME" as const };
  const [listings, upcomingBookings, licensesExpiring, licensesPending, tasks] = await Promise.all([
    db.listing.count({ where: homes }),
    db.booking.count({ where: { organizationId, status: "CONFIRMED", source: { not: "OWNER" }, checkIn: { gte: today } } }),
    db.listing.count({ where: { ...homes, licenseExpiresAt: { lte: alertLimit } } }),
    db.listing.count({ where: { ...homes, licenseExpiresAt: null } }),
    taskCounts(organizationId, today),
  ]);
  return { listings, upcomingBookings, licensesExpiring, licensesPending, ...tasks };
}

export interface LicenseAlert {
  id: string;
  title: string;
  licenseNumber: string | null;
  licenseExpiresAt: Date;
}

/** The homes behind licensesExpiring, soonest first. */
export async function expiringLicenses(organizationId: string, today = todayInTimeZone(MARRAKECH_TIMEZONE), take = 10): Promise<LicenseAlert[]> {
  const alertLimit = new Date(today.getTime() + LICENSE_ALERT_DAYS * DAY);
  const rows = await db.listing.findMany({
    where: { organizationId, category: "HOME", licenseExpiresAt: { lte: alertLimit } },
    select: { id: true, title: true, licenseNumber: true, licenseExpiresAt: true },
    orderBy: [{ licenseExpiresAt: "asc" }, { id: "asc" }],
    take,
  });
  return rows.map((r) => ({ ...r, licenseExpiresAt: r.licenseExpiresAt! }));
}
