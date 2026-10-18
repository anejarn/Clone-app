import "server-only";
import { invitationExpiry, invitationStatus, ROLE_LABEL, type InvitationStatus, type InviteInput } from "@/lib/admin/users";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { Role } from "@/lib/generated/prisma/enums";
import { pluralize } from "@/lib/format";
import { recordAudit } from "../audit";
import type { Authorized } from "../authz";
import { db } from "../db";
import { AppError } from "../errors";
import { generateInvitationToken, hashInvitationToken } from "./invitation-token";

/**
 * Utilisateurs (back-office, ADMIN only): members of the organization, invitations, role changes, double
 * authentification reset, deactivation. Every function takes the caller (from requireAdminAction /
 * requireAdminPage, lib/server/authz.ts) and only reads or writes the caller's organization: a user or invitation
 * id of another organization is answered 404, as an unknown one. Changes that touch roles or access run under a
 * per-organization lock (lockMembers) so that two admins can't, together, leave the organization without an ADMIN.
 * Each change is written to audit_logs in the same transaction, and revokes the target's sessions when it changes
 * what they may do.
 */

const userNotFound = () => new AppError(404, "NOT_FOUND", "Utilisateur introuvable.");
const invitationNotFound = () => new AppError(404, "NOT_FOUND", "Invitation introuvable.");

/** Serializes membership changes of one organization (transaction-scoped Postgres advisory lock). */
export async function lockMembers(tx: Prisma.TransactionClient, organizationId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`members:${organizationId}`}))`;
}

/** Signs the user out everywhere. Back-office access is re-read from the database anyway (checkAccess). */
export async function revokeSessions(tx: Prisma.TransactionClient, userId: string) {
  await tx.session.deleteMany({ where: { userId } });
}

/**
 * The rules a role change must keep, inside the members lock. Throws 409 with what to do instead.
 * - The organization keeps at least one active ADMIN.
 * - A propriétaire who owns listings stays OWNER (also enforced by the database: users_owner_role_check).
 */
export async function assertRoleChangeAllowed(
  tx: Prisma.TransactionClient,
  target: {
    id: string;
    role: Role;
    organizationId: string | null;
    deactivatedAt: Date | null;
  },
  role: Role,
) {
  if (target.role === role || !target.organizationId) return;
  if (target.role === "ADMIN" && !target.deactivatedAt) {
    const otherAdmins = await tx.user.count({
      where: {
        organizationId: target.organizationId,
        role: "ADMIN",
        deactivatedAt: null,
        id: { not: target.id },
      },
    });
    if (otherAdmins === 0) {
      throw new AppError(409, "LAST_ADMIN", "C'est le dernier associé (ADMIN) actif de l'organisation : nommez d'abord un autre ADMIN.");
    }
  }
  if (target.role === "OWNER") {
    const listings = await tx.listing.count({ where: { ownerId: target.id } });
    if (listings > 0) {
      throw new AppError(
        409,
        "OWNER_HAS_LISTINGS",
        `Ce propriétaire a ${pluralize(listings, "bien", "biens")} : choisissez d'abord un autre propriétaire pour ${listings > 1 ? "ces biens" : "ce bien"} (Biens → Modifier), puis changez son rôle.`,
      );
    }
  }
}

// ---------- Members ----------

export interface UserFilters {
  role?: Role;
  /** Name, e-mail or phone, case-insensitive. */
  q?: string;
}

/** The organization's members (every role, deactivated included), admins first, then by name. */
export async function listOrgUsers(organizationId: string, filters: UserFilters = {}) {
  const q = filters.q?.trim();
  const rows = await db.user.findMany({
    where: {
      organizationId,
      ...(filters.role && { role: filters.role }),
      ...(q && {
        OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }],
      }),
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      twoFactorEnabled: true,
      lastSignInAt: true,
      deactivatedAt: true,
      createdAt: true,
      invitationsAccepted: {
        where: { organizationId },
        select: { acceptedAt: true },
        orderBy: { acceptedAt: "desc" },
        take: 1,
      },
      _count: { select: { listings: true } },
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  const order: Record<Role, number> = {
    ADMIN: 0,
    AGENT: 1,
    OWNER: 2,
    GUEST: 3,
  };
  return rows
    .map(({ invitationsAccepted, _count, ...u }) => ({
      ...u,
      invitedAcceptedAt: invitationsAccepted[0]?.acceptedAt ?? null,
      listingCount: _count.listings,
    }))
    .sort((a, b) => order[a.role] - order[b.role]);
}

export type OrgUserRow = Awaited<ReturnType<typeof listOrgUsers>>[number];

/** One member of the organization, or null (unknown, or of another organization). */
export async function getOrgUser(organizationId: string, id: string) {
  const u = await db.user.findFirst({
    where: { id, organizationId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      twoFactorEnabled: true,
      lastSignInAt: true,
      deactivatedAt: true,
      createdAt: true,
      _count: { select: { listings: true, sessions: true } },
      invitationsAccepted: {
        where: { organizationId },
        select: { acceptedAt: true, invitedBy: { select: { name: true } } },
        orderBy: { acceptedAt: "desc" },
        take: 1,
      },
    },
  });
  if (!u) return null;
  const { _count, invitationsAccepted, ...rest } = u;
  return {
    ...rest,
    listingCount: _count.listings,
    sessionCount: _count.sessions,
    invitation: invitationsAccepted[0] ?? null,
  };
}

export type OrgUser = NonNullable<Awaited<ReturnType<typeof getOrgUser>>>;

async function findTarget(tx: Prisma.TransactionClient, organizationId: string, userId: string) {
  const target = await tx.user.findFirst({
    where: { id: userId, organizationId },
    select: {
      id: true,
      role: true,
      organizationId: true,
      deactivatedAt: true,
      twoFactorEnabled: true,
    },
  });
  if (!target) throw userNotFound();
  return target;
}

/** Changes a member's role at once (their sessions are revoked). Returns whether anything changed. */
export async function changeUserRole(actor: Authorized, userId: string, role: Role): Promise<{ changed: boolean; self: boolean }> {
  const { organizationId } = actor;
  return db.$transaction(async (tx) => {
    await lockMembers(tx, organizationId);
    const target = await findTarget(tx, organizationId, userId);
    if (target.role === role) return { changed: false, self: target.id === actor.user.id };
    await assertRoleChangeAllowed(tx, target, role);
    await tx.user.update({ where: { id: target.id }, data: { role } });
    await revokeSessions(tx, target.id);
    await recordAudit(tx, {
      organizationId,
      actorId: actor.user.id,
      action: "user.role_changed",
      targetType: "user",
      targetId: target.id,
      details: { from: target.role, to: role },
    });
    return { changed: true, self: target.id === actor.user.id };
  });
}

/**
 * Lost phone: turns off a member's double authentification (secret and backup codes deleted) and signs them out
 * everywhere; staff must enroll again at their next sign-in (checkAccess sends them to /admin/securite). Not on
 * oneself (use Sécurité du compte). The caller checks the acting admin's password first (see the action).
 */
export async function resetUserTwoFactor(actor: Authorized, userId: string) {
  const { organizationId } = actor;
  await db.$transaction(async (tx) => {
    await lockMembers(tx, organizationId);
    const target = await findTarget(tx, organizationId, userId);
    if (target.id === actor.user.id) {
      throw new AppError(422, "SELF", "Pour votre propre compte, passez par « Sécurité du compte ».");
    }
    const rows = await tx.twoFactor.deleteMany({
      where: { userId: target.id },
    });
    if (!target.twoFactorEnabled && rows.count === 0) {
      throw new AppError(409, "NO_TWO_FACTOR", "Ce compte n'a pas de double authentification à réinitialiser.");
    }
    await tx.user.update({
      where: { id: target.id },
      data: { twoFactorEnabled: false },
    });
    await revokeSessions(tx, target.id);
    await recordAudit(tx, {
      organizationId,
      actorId: actor.user.id,
      action: "user.two_factor_reset",
      targetType: "user",
      targetId: target.id,
    });
  });
}

/**
 * Soft deactivation: the account can't sign in (lib/server/auth.ts) and is signed out everywhere; nothing is
 * deleted (bookings, listings, history stay). Reactivation gives access back with the same role. Not on oneself.
 */
export async function setUserActive(actor: Authorized, userId: string, active: boolean): Promise<{ changed: boolean }> {
  const { organizationId } = actor;
  return db.$transaction(async (tx) => {
    await lockMembers(tx, organizationId);
    const target = await findTarget(tx, organizationId, userId);
    if (target.id === actor.user.id) throw new AppError(422, "SELF", "Vous ne pouvez pas désactiver votre propre compte.");
    if (active === !target.deactivatedAt) return { changed: false };
    if (!active && target.role === "ADMIN") {
      const otherAdmins = await tx.user.count({
        where: {
          organizationId,
          role: "ADMIN",
          deactivatedAt: null,
          id: { not: target.id },
        },
      });
      if (otherAdmins === 0) throw new AppError(409, "LAST_ADMIN", "C'est le dernier associé (ADMIN) actif de l'organisation.");
    }
    await tx.user.update({
      where: { id: target.id },
      data: { deactivatedAt: active ? null : new Date() },
    });
    if (!active) await revokeSessions(tx, target.id);
    await recordAudit(tx, {
      organizationId,
      actorId: actor.user.id,
      action: active ? "user.reactivated" : "user.deactivated",
      targetType: "user",
      targetId: target.id,
    });
    return { changed: true };
  });
}

// ---------- Invitations ----------

export interface InvitationRow {
  id: string;
  email: string;
  role: Role;
  phone: string | null;
  status: InvitationStatus;
  expiresAt: Date;
  createdAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  invitedByName: string | null;
}

/** Open invitations (pending or expired) and the latest closed ones, newest first. */
export async function listInvitations(organizationId: string, now = new Date()): Promise<InvitationRow[]> {
  const rows = await db.invitation.findMany({
    where: { organizationId },
    select: {
      id: true,
      email: true,
      role: true,
      phone: true,
      expiresAt: true,
      createdAt: true,
      acceptedAt: true,
      revokedAt: true,
      updatedAt: true,
      invitedBy: { select: { name: true } },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: 100,
  });
  return rows.map(({ invitedBy, updatedAt: _u, ...r }) => ({
    ...r,
    status: invitationStatus(r, now),
    invitedByName: invitedBy?.name ?? null,
  }));
}

export interface IssuedInvitation {
  id: string;
  email: string;
  role: Role;
  phone: string | null;
  expiresAt: Date;
  /** The secret for the link. Returned once, never stored. */
  token: string;
}

/**
 * Invites someone to the organization. Refused when the address is already a member (change their role instead)
 * or has an invitation still pending (resend or revoke it). An expired open invitation for the same address is
 * renewed. Accounts outside the organization are not revealed: the check happens at acceptance.
 */
export async function createInvitation(actor: Authorized, input: InviteInput, now = new Date()): Promise<IssuedInvitation> {
  const { organizationId } = actor;
  const token = generateInvitationToken();
  const data = {
    role: input.role,
    phone: input.phone,
    tokenHash: hashInvitationToken(token),
    expiresAt: invitationExpiry(now),
    invitedById: actor.user.id,
  };
  const inv = await db.$transaction(async (tx) => {
    await lockMembers(tx, organizationId);
    const member = await tx.user.findFirst({
      where: { email: input.email, organizationId },
      select: { role: true },
    });
    if (member) {
      throw new AppError(
        409,
        "ALREADY_MEMBER",
        `Cette adresse est déjà membre de l'organisation (${ROLE_LABEL[member.role]}) : changez son rôle dans la liste.`,
      );
    }
    const open = await tx.invitation.findFirst({
      where: {
        organizationId,
        email: input.email,
        acceptedAt: null,
        revokedAt: null,
      },
      select: { id: true, expiresAt: true },
    });
    if (open && open.expiresAt > now) {
      throw new AppError(409, "INVITATION_PENDING", "Une invitation est déjà en attente pour cette adresse : renvoyez-la ou révoquez-la.");
    }
    const row = open
      ? await tx.invitation.update({ where: { id: open.id }, data })
      : await tx.invitation.create({
          data: { ...data, organizationId, email: input.email },
        });
    await recordAudit(tx, {
      organizationId,
      actorId: actor.user.id,
      action: "invitation.created",
      targetType: "invitation",
      targetId: row.id,
      details: { email: row.email, role: row.role },
    });
    return row;
  });
  return {
    id: inv.id,
    email: inv.email,
    role: inv.role,
    phone: inv.phone,
    expiresAt: inv.expiresAt,
    token,
  };
}

/** A new link (new token, new 7-day validity) for a pending or expired invitation; the previous link stops working. */
export async function resendInvitation(actor: Authorized, invitationId: string, now = new Date()): Promise<IssuedInvitation> {
  const { organizationId } = actor;
  const token = generateInvitationToken();
  const inv = await db.$transaction(async (tx) => {
    await lockMembers(tx, organizationId);
    const found = await tx.invitation.findFirst({
      where: { id: invitationId, organizationId },
    });
    if (!found) throw invitationNotFound();
    const status = invitationStatus(found, now);
    if (status === "ACCEPTED") throw new AppError(409, "INVITATION_ACCEPTED", "Cette invitation a déjà été acceptée.");
    if (status === "REVOKED") throw new AppError(409, "INVITATION_REVOKED", "Cette invitation a été révoquée : créez-en une nouvelle.");
    const row = await tx.invitation.update({
      where: { id: found.id },
      data: {
        tokenHash: hashInvitationToken(token),
        expiresAt: invitationExpiry(now),
        invitedById: actor.user.id,
      },
    });
    await recordAudit(tx, {
      organizationId,
      actorId: actor.user.id,
      action: "invitation.resent",
      targetType: "invitation",
      targetId: row.id,
      details: { email: row.email },
    });
    return row;
  });
  return {
    id: inv.id,
    email: inv.email,
    role: inv.role,
    phone: inv.phone,
    expiresAt: inv.expiresAt,
    token,
  };
}

/** The link stops working at once. An accepted invitation can't be revoked (change the member's role instead). */
export async function revokeInvitation(actor: Authorized, invitationId: string): Promise<{ changed: boolean }> {
  const { organizationId } = actor;
  return db.$transaction(async (tx) => {
    await lockMembers(tx, organizationId);
    const found = await tx.invitation.findFirst({
      where: { id: invitationId, organizationId },
    });
    if (!found) throw invitationNotFound();
    if (found.acceptedAt) throw new AppError(409, "INVITATION_ACCEPTED", "Cette invitation a déjà été acceptée : changez plutôt le rôle du membre.");
    if (found.revokedAt) return { changed: false };
    await tx.invitation.update({
      where: { id: found.id },
      data: { revokedAt: new Date() },
    });
    await recordAudit(tx, {
      organizationId,
      actorId: actor.user.id,
      action: "invitation.revoked",
      targetType: "invitation",
      targetId: found.id,
      details: { email: found.email },
    });
    return { changed: true };
  });
}

/** The organization's name, for messages. */
export async function organizationName(organizationId: string) {
  return (
    await db.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true },
    })
  ).name;
}
