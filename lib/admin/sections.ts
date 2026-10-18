import type { Role } from "@/lib/generated/prisma/enums";

/**
 * The back-office (/admin) and who may open each part. One list for the navigation and for access control: every
 * page calls requireAdminPage(href) (lib/server/authz.ts), which reads the roles from here, and the integration
 * tests check every entry for every role. ADMIN = associé (everything); AGENT = agent terrain (day-to-day parts only).
 */
export type StaffRole = Extract<Role, "ADMIN" | "AGENT">;

export const STAFF_ROLES: readonly StaffRole[] = ["ADMIN", "AGENT"];

export interface AdminSection {
  href: AdminPath;
  label: string;
  roles: readonly StaffRole[];
  /** False while the section is a "Bientôt" placeholder (later Lot 2 items). */
  ready: boolean;
  /** Shown in the sidebar. The security page is reached from the account box instead. */
  nav: boolean;
}

export type AdminPath =
  | "/admin"
  | "/admin/biens"
  | "/admin/reservations"
  | "/admin/reservations/nouvelle"
  | "/admin/calendrier"
  | "/admin/operations"
  | "/admin/mes-taches"
  | "/admin/prix"
  | "/admin/utilisateurs"
  | "/admin/securite";

export const ADMIN_SECTIONS: readonly AdminSection[] = [
  { href: "/admin", label: "Tableau de bord", roles: ["ADMIN", "AGENT"], ready: true, nav: true },
  { href: "/admin/biens", label: "Biens", roles: ["ADMIN"], ready: true, nav: true },
  { href: "/admin/reservations", label: "Réservations", roles: ["ADMIN", "AGENT"], ready: true, nav: true },
  // Typing a booking or an owner block by hand, changing its dates, cancelling it: associés only (BOOKING_ENTRY_PATH).
  { href: "/admin/reservations/nouvelle", label: "Nouvelle saisie", roles: ["ADMIN"], ready: true, nav: false },
  { href: "/admin/calendrier", label: "Calendrier", roles: ["ADMIN", "AGENT"], ready: true, nav: true },
  // Field tasks: every task of the organization, assignment, times, manual tasks (associés).
  { href: "/admin/operations", label: "Opérations", roles: ["ADMIN"], ready: true, nav: true },
  // The tasks assigned to the person signed in (agents: theirs only), check-lists and photos, on a phone.
  { href: "/admin/mes-taches", label: "Mes tâches", roles: ["ADMIN", "AGENT"], ready: true, nav: true },
  { href: "/admin/prix", label: "Prix", roles: ["ADMIN"], ready: true, nav: true },
  { href: "/admin/utilisateurs", label: "Utilisateurs", roles: ["ADMIN"], ready: true, nav: true },
  // Double authentification: the one page a staff member can open before enrolling.
  { href: "/admin/securite", label: "Sécurité du compte", roles: ["ADMIN", "AGENT"], ready: true, nav: false },
];

/**
 * The section whose roles may write bookings (create, change dates, cancel, owner blocks): every booking action
 * calls requireAdminAction(BOOKING_ENTRY_PATH). Agents read the calendar and the bookings, without amounts.
 */
export const BOOKING_ENTRY_PATH: AdminPath = "/admin/reservations/nouvelle";

/** Booking amounts (nightly price, cleaning, total) are for associés only; agents see dates, guests and contacts. */
export function canSeeBookingAmounts(role: Role): boolean {
  return role === "ADMIN";
}

/** Whether a role may write bookings (BOOKING_ENTRY_PATH's roles). */
export function canWriteBookings(role: Role): boolean {
  return (adminSection(BOOKING_ENTRY_PATH).roles as readonly Role[]).includes(role);
}

/** Field tasks: the associés' view of every task, and the page where a task is done (check-list, photos). */
export const OPERATIONS_PATH: AdminPath = "/admin/operations";
export const MY_TASKS_PATH: AdminPath = "/admin/mes-taches";

/** Associés see and work on every task of the organization; an agent only on the tasks assigned to them. */
export function canSeeAllTasks(role: Role): boolean {
  return role === "ADMIN";
}

/** Where a staff member without double authentification is sent. */
export const TWO_FACTOR_SETUP_PATH: AdminPath = "/admin/securite";

export function adminSection(href: AdminPath): AdminSection {
  const s = ADMIN_SECTIONS.find((x) => x.href === href);
  if (!s) throw new Error(`Unknown admin section ${href}`);
  return s;
}

/** The sidebar entries a role sees. */
export function navFor(role: StaffRole): AdminSection[] {
  return ADMIN_SECTIONS.filter((s) => s.nav && s.roles.includes(role));
}
