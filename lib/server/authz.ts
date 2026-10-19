import "server-only";
import { headers as requestHeaders } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { adminSection, STAFF_ROLES, TWO_FACTOR_SETUP_PATH, type AdminPath } from "@/lib/admin/sections";
import type { Role } from "@/lib/generated/prisma/enums";
import { auth } from "./auth";
import { AppError } from "./errors";

/**
 * Server-side access control for organization members (ADMIN, AGENT, OWNER). Every back-office page, server
 * action and API handler goes through one of the three wrappers below, which all use checkAccess():
 *
 * - requireAdminPage(href) / requireOwnerPage(href) / requireRole(...roles) for pages: anonymous → /login, wrong role → 404 (the
 *   back-office isn't revealed to guests and owners), staff without double authentification → /admin/securite;
 * - requireAdminAction(href) / requireRoleAction(...roles) for server actions and requireAdminApi(request, href) /
 *   requireRoleApi(request, ...roles) for Route Handlers: AppError 401 UNAUTHENTICATED, 403 FORBIDDEN or
 *   403 TWO_FACTOR_REQUIRED.
 * The *Admin* variants take the roles of a back-office section from ADMIN_SECTIONS (lib/admin/sections.ts).
 *
 * The returned organizationId is the only one the caller may read or write: queries take it as their first
 * argument, as everywhere else in lib/server. Role, organization and 2FA status are read from the database on
 * every call (session cookie cache bypassed), so a role change or a revoked session takes effect at once.
 */

export interface Authorized {
  user: { id: string; name: string; email: string; role: Role; twoFactorEnabled: boolean };
  organizationId: string;
}

export type AccessDenial = "UNAUTHENTICATED" | "FORBIDDEN" | "TWO_FACTOR_REQUIRED";
export type AccessResult = ({ ok: true } & Authorized) | { ok: false; reason: AccessDenial };

/** Roles that must have double authentification before any back-office access. */
export const TWO_FACTOR_ROLES: readonly Role[] = STAFF_ROLES;

export interface AccessOptions {
  /** Request headers (Route Handlers, tests); pages and actions default to next/headers. */
  headers?: Headers;
  /** Only for the enrollment page itself: let staff in before they turn on double authentification. */
  allowWithoutTwoFactor?: boolean;
}

/** The access decision, without side effects. */
export async function checkAccess(roles: readonly Role[], opts: AccessOptions = {}): Promise<AccessResult> {
  const session = await auth.api.getSession({
    headers: opts.headers ?? (await requestHeaders()),
    query: { disableCookieCache: true },
  });
  // A deactivated account has no sessions left (lib/server/admin/users.ts revokes them); refuse it anyway.
  if (!session || session.user.deactivatedAt) return { ok: false, reason: "UNAUTHENTICATED" };
  const { id, name, email, organizationId, twoFactorEnabled } = session.user;
  const role = session.user.role as Role;
  if (!roles.includes(role) || !organizationId) return { ok: false, reason: "FORBIDDEN" };
  if (TWO_FACTOR_ROLES.includes(role) && !twoFactorEnabled && !opts.allowWithoutTwoFactor) {
    return { ok: false, reason: "TWO_FACTOR_REQUIRED" };
  }
  return { ok: true, user: { id, name, email, role, twoFactorEnabled: !!twoFactorEnabled }, organizationId };
}

function enforceOnPage(result: AccessResult, next: string): Authorized {
  if (result.ok) return { user: result.user, organizationId: result.organizationId };
  if (result.reason === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(next)}`);
  if (result.reason === "TWO_FACTOR_REQUIRED") redirect(TWO_FACTOR_SETUP_PATH);
  notFound();
}

/** A back-office page: the roles come from ADMIN_SECTIONS (lib/admin/sections.ts). */
export async function requireAdminPage(href: AdminPath, opts: Pick<AccessOptions, "headers"> = {}): Promise<Authorized> {
  const section = adminSection(href);
  const result = await checkAccess(section.roles, { ...opts, allowWithoutTwoFactor: href === TWO_FACTOR_SETUP_PATH });
  return enforceOnPage(result, href);
}

/** Any other page restricted to some roles. */
export async function requireRole(...roles: [Role, ...Role[]]): Promise<Authorized> {
  return enforceOnPage(await checkAccess(roles), "/admin");
}

/** The owner portal (/proprietaire, Lot 6b). */
export const OWNER_PORTAL_PATH = "/proprietaire";

/**
 * A page of the owner portal: OWNER of an organization only (anonymous → /login?next=<href>, any other role → 404).
 * Double authentification is optional for owners (offered on /proprietaire/securite, asked at sign-in once on).
 */
export async function requireOwnerPage(href: string = OWNER_PORTAL_PATH, opts: Pick<AccessOptions, "headers"> = {}): Promise<Authorized> {
  return enforceOnPage(await checkAccess(["OWNER"], opts), href.startsWith(OWNER_PORTAL_PATH) ? href : OWNER_PORTAL_PATH);
}

function enforceAsError(result: AccessResult): Authorized {
  if (result.ok) return { user: result.user, organizationId: result.organizationId };
  if (result.reason === "UNAUTHENTICATED") throw new AppError(401, "UNAUTHENTICATED", "Connectez-vous pour continuer.");
  if (result.reason === "TWO_FACTOR_REQUIRED") {
    throw new AppError(403, "TWO_FACTOR_REQUIRED", "Activez la double authentification pour accéder à l'espace équipe.");
  }
  throw new AppError(403, "FORBIDDEN", "Accès refusé.");
}

/** Server actions: throws AppError (catch it to return { error }). */
export async function requireRoleAction(...roles: [Role, ...Role[]]): Promise<Authorized> {
  return enforceAsError(await checkAccess(roles));
}

/** Route Handlers, inside handle(): the AppError becomes a JSON 401/403. */
export async function requireRoleApi(request: Request, ...roles: [Role, ...Role[]]): Promise<Authorized> {
  return enforceAsError(await checkAccess(roles, { headers: request.headers }));
}

/** A back-office server action, with the roles of the section it belongs to. */
export async function requireAdminAction(href: AdminPath, opts: Pick<AccessOptions, "headers"> = {}): Promise<Authorized> {
  return enforceAsError(await checkAccess(adminSection(href).roles, opts));
}

/** A back-office Route Handler, with the roles of the section it serves. */
export async function requireAdminApi(request: Request, href: AdminPath): Promise<Authorized> {
  return enforceAsError(await checkAccess(adminSection(href).roles, { headers: request.headers }));
}
