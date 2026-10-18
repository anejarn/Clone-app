import "server-only";
import { invitationStatus, type AcceptInput, type InvitationStatus } from "@/lib/admin/users";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { Role } from "@/lib/generated/prisma/enums";
import { assertRoleChangeAllowed, lockMembers } from "./admin/users";
import { hashInvitationToken, TOKEN_RE } from "./admin/invitation-token";
import { recordAudit } from "./audit";
import { auth } from "./auth";
import { db } from "./db";
import { AppError } from "./errors";

/**
 * Accepting an invitation (/invitation/<token>, public). The token is looked up by its hash; it works once, until
 * it expires or is revoked or resent. Two ways in:
 * - no account with the invited e-mail: the invitee chooses a name and a password; the account is created with the
 *   invited role in the inviting organization (e-mail taken as verified: only the person who got the link can
 *   use it);
 * - an account exists: the invitee signs in with it, then accepts; the account gets the role and the organization,
 *   unless it already belongs to another organization (an account never moves between organizations).
 * Public sign-up is unchanged: it always creates a GUEST without organization (lib/server/auth.ts).
 */

export interface InvitationView {
  status: InvitationStatus;
  email: string;
  role: Role;
  organizationName: string;
  /** An account with this e-mail exists (the invitee then signs in instead of creating one). */
  accountExists: boolean;
  acceptedById: string | null;
}

async function findByToken(token: string, tx: Prisma.TransactionClient = db) {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return null;
  return tx.invitation.findUnique({
    where: { tokenHash: hashInvitationToken(token) },
    include: { organization: { select: { name: true } } },
  });
}

/** What the invitation page shows; null for an unknown (or replaced) token. */
export async function viewInvitation(token: string, now = new Date()): Promise<InvitationView | null> {
  const inv = await findByToken(token);
  if (!inv) return null;
  const accountExists = (await db.user.count({ where: { email: inv.email } })) > 0;
  return {
    status: invitationStatus(inv, now),
    email: inv.email,
    role: inv.role,
    organizationName: inv.organization.name,
    accountExists,
    acceptedById: inv.acceptedById,
  };
}

const MESSAGES: Record<Exclude<InvitationStatus, "PENDING">, string> = {
  ACCEPTED: "Cette invitation a déjà été utilisée.",
  REVOKED: "Cette invitation a été annulée. Demandez un nouveau lien à l'équipe.",
  EXPIRED: "Cette invitation a expiré. Demandez un nouveau lien à l'équipe.",
};

/**
 * Finds the invitation, takes its organization's members lock, and claims it (acceptedAt) only if it is still
 * pending: two accepts of the same link can't both succeed. Throws when the link no longer works.
 */
async function claim(tx: Prisma.TransactionClient, token: string, now: Date) {
  const inv = await findByToken(token, tx);
  if (!inv) throw new AppError(404, "INVITATION_NOT_FOUND", "Invitation introuvable. Vérifiez le lien, ou demandez-en un nouveau.");
  await lockMembers(tx, inv.organizationId);
  const claimed = await tx.invitation.updateMany({
    where: {
      id: inv.id,
      tokenHash: inv.tokenHash,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    data: { acceptedAt: now },
  });
  if (claimed.count === 0) {
    const fresh = await tx.invitation.findUnique({ where: { id: inv.id } });
    const status = fresh && fresh.tokenHash === inv.tokenHash ? invitationStatus(fresh, now) : "REVOKED";
    throw new AppError(409, `INVITATION_${status}`, MESSAGES[status === "PENDING" ? "ACCEPTED" : status]);
  }
  return inv;
}

/** Creates the invitee's account (no account must exist with that e-mail). Returns what to sign in with. */
export async function acceptWithNewAccount(token: string, input: AcceptInput, now = new Date()) {
  // Hashing is slow (scrypt): before the transaction, so the lock is held briefly.
  const password = await (await auth.$context).password.hash(input.password);
  return db.$transaction(async (tx) => {
    const inv = await claim(tx, token, now);
    if (await tx.user.count({ where: { email: inv.email } })) {
      throw new AppError(409, "ACCOUNT_EXISTS", "Un compte existe déjà avec cette adresse : connectez-vous pour accepter l'invitation.");
    }
    const user = await tx.user.create({
      data: {
        name: input.name,
        email: inv.email,
        emailVerified: true,
        role: inv.role,
        organizationId: inv.organizationId,
        phone: inv.phone,
      },
    });
    await tx.account.create({
      data: {
        id: `acc_${user.id}`,
        accountId: user.id,
        providerId: "credential",
        userId: user.id,
        password,
      },
    });
    await tx.invitation.update({
      where: { id: inv.id },
      data: { acceptedById: user.id },
    });
    await recordAudit(tx, {
      organizationId: inv.organizationId,
      actorId: user.id,
      action: "invitation.accepted",
      targetType: "invitation",
      targetId: inv.id,
      details: { email: inv.email, role: inv.role, newAccount: true },
    });
    return { userId: user.id, email: user.email, role: user.role };
  });
}

/** The signed-in user accepts: their e-mail must be the invited one. */
export async function acceptWithExistingAccount(token: string, userId: string, now = new Date()) {
  return db.$transaction(async (tx) => {
    const inv = await claim(tx, token, now);
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        organizationId: true,
        deactivatedAt: true,
        phone: true,
      },
    });
    if (!user || user.email.toLowerCase() !== inv.email) {
      throw new AppError(403, "WRONG_ACCOUNT", "Cette invitation est destinée à une autre adresse e-mail.");
    }
    if (user.deactivatedAt) throw new AppError(403, "ACCOUNT_DEACTIVATED", "Ce compte est désactivé. Contactez l'équipe.");
    if (user.organizationId && user.organizationId !== inv.organizationId) {
      throw new AppError(409, "OTHER_ORGANIZATION", "Ce compte appartient déjà à une autre organisation : acceptez avec une autre adresse e-mail.");
    }
    // Already a member (e.g. turned into a guest since): the usual role-change rules apply.
    await assertRoleChangeAllowed(tx, { ...user, organizationId: user.organizationId }, inv.role);
    await tx.user.update({
      where: { id: user.id },
      data: {
        role: inv.role,
        organizationId: inv.organizationId,
        ...(!user.phone && inv.phone && { phone: inv.phone }),
      },
    });
    await tx.invitation.update({
      where: { id: inv.id },
      data: { acceptedById: user.id },
    });
    await recordAudit(tx, {
      organizationId: inv.organizationId,
      actorId: user.id,
      action: "invitation.accepted",
      targetType: "invitation",
      targetId: inv.id,
      details: {
        email: inv.email,
        role: inv.role,
        from: user.role,
        newAccount: false,
      },
    });
    return { userId: user.id, email: user.email, role: inv.role };
  });
}
