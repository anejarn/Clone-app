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
  | "/admin/calendrier"
  | "/admin/prix"
  | "/admin/utilisateurs"
  | "/admin/securite";

export const ADMIN_SECTIONS: readonly AdminSection[] = [
  { href: "/admin", label: "Tableau de bord", roles: ["ADMIN", "AGENT"], ready: true, nav: true },
  { href: "/admin/biens", label: "Biens", roles: ["ADMIN"], ready: true, nav: true },
  { href: "/admin/reservations", label: "Réservations", roles: ["ADMIN", "AGENT"], ready: false, nav: true },
  { href: "/admin/calendrier", label: "Calendrier", roles: ["ADMIN", "AGENT"], ready: false, nav: true },
  { href: "/admin/prix", label: "Prix", roles: ["ADMIN"], ready: false, nav: true },
  { href: "/admin/utilisateurs", label: "Utilisateurs", roles: ["ADMIN"], ready: false, nav: true },
  // Double authentification: the one page a staff member can open before enrolling.
  { href: "/admin/securite", label: "Sécurité du compte", roles: ["ADMIN", "AGENT"], ready: true, nav: false },
];

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
