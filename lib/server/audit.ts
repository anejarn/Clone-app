import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { db } from "./db";

/**
 * Audit trail of security-sensitive actions (table audit_logs): who, what, on what, when. Bookings and owner blocks
 * typed, re-dated or cancelled in the back-office are recorded too (lib/server/admin/bookings.ts), without the
 * guest's contact details; so are the seasons and events of Prix (lib/server/admin/prices.ts: created, changed,
 * deleted, with the whole rule). Written inside the transaction of the change it records, so there is no change without
 * its entry. Never put secrets in details.
 * Finances (Lot 6) will add their own actions.
 */

export type AuditAction =
  | "invitation.created"
  | "invitation.resent"
  | "invitation.revoked"
  | "invitation.accepted"
  | "user.role_changed"
  | "user.two_factor_reset"
  | "user.deactivated"
  | "user.reactivated"
  | "booking.created"
  | "booking.dates_changed"
  | "booking.cancelled"
  | "owner_block.created"
  | "owner_block.cancelled"
  | "price_rule.created"
  | "price_rule.updated"
  | "price_rule.deleted";

export interface AuditEntry {
  organizationId: string;
  actorId: string | null;
  action: AuditAction;
  targetType: "user" | "invitation" | "booking" | "price_rule";
  targetId: string;
  details?: Prisma.InputJsonObject;
}

export async function recordAudit(tx: Prisma.TransactionClient, entry: AuditEntry) {
  await tx.auditLog.create({
    data: { ...entry, details: entry.details ?? {} },
  });
}

/** The organization's latest entries, with the names of the people they mention when the accounts still exist. */
export async function recentAudit(organizationId: string, opts: { targetId?: string; take?: number } = {}) {
  const rows = await db.auditLog.findMany({
    where: {
      organizationId,
      ...(opts.targetId && { targetId: opts.targetId }),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: opts.take ?? 20,
  });
  const ids = [...new Set(rows.flatMap((r) => [r.actorId, r.targetType === "user" ? r.targetId : null]).filter((x): x is string => !!x))];
  // Entries of this organization only name people who acted in it or were its members (or invitees who accepted).
  const users = ids.length
    ? await db.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  return rows.map((r) => ({
    ...r,
    actor: r.actorId ? (byId.get(r.actorId) ?? null) : null,
    target: r.targetType === "user" ? (byId.get(r.targetId) ?? null) : null,
  }));
}
