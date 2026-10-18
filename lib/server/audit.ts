import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { db } from "./db";

/**
 * Audit trail of security-sensitive actions (table audit_logs): who, what, on what, when. Bookings and owner blocks
 * typed, re-dated or cancelled in the back-office are recorded too (lib/server/admin/bookings.ts), without the
 * guest's contact details; so are the seasons and events of Prix (lib/server/admin/prices.ts: created, changed,
 * deleted, with the whole rule), and field tasks (lib/server/operations/tasks.ts: typed by hand, assigned, re-timed,
 * started, done, cancelled, reopened — from Ma journée too, offline changes included; ticks and photos are on the task
 * itself), and breakdown reports (lib/server/operations/tickets.ts: reported, status, assignment, priority and cost
 * changes; comments and photos are on the ticket's thread), and the welcome guide (lib/server/guide/admin.ts: texts,
 * Wi-Fi, codes added/changed/deleted — never their values —, every reveal of the codes by the team, photos,
 * recommendations, guide links issued and revoked, the conciergerie's contact), and the travellers' declaration (Lot 5,
 * lib/server/declarations/: every fiche added, changed, deleted, every view of the fiches or of a document scan, every
 * export, declared/undeclared, the automatic purge — counts and ids only, never a name, a number or a date of birth)
 * and the taxe de séjour (rates added and deleted, snapshots closed and reopened, reports exported). Written inside the
 * transaction of the change it records, so there is no change without its entry. Never put secrets or personal data
 * in details.
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
  | "price_rule.deleted"
  | "task.created"
  | "task.assigned"
  | "task.rescheduled"
  | "task.status_changed"
  | "ticket.created"
  | "ticket.status_changed"
  | "ticket.assigned"
  | "ticket.priority_changed"
  | "ticket.cost_changed"
  | "guide.updated"
  | "guide.wifi_updated"
  | "guide.code_added"
  | "guide.code_updated"
  | "guide.code_deleted"
  | "guide.secrets_revealed"
  | "guide.photo_added"
  | "guide.photo_deleted"
  | "guide.recommendation_added"
  | "guide.recommendation_updated"
  | "guide.recommendation_deleted"
  | "guide.link_issued"
  | "guide.link_revoked"
  | "organization.concierge_updated"
  | "traveler.added"
  | "traveler.updated"
  | "traveler.deleted"
  | "travelers.viewed"
  | "traveler.document_added"
  | "traveler.document_viewed"
  | "traveler.document_deleted"
  | "travelers.declared"
  | "travelers.undeclared"
  | "declaration.exported"
  | "identity.purged"
  | "organization.identity_retention_updated"
  | "tourist_tax.rate_added"
  | "tourist_tax.rate_deleted"
  | "tourist_tax.closed"
  | "tourist_tax.reopened"
  | "tourist_tax.report_exported";

export interface AuditEntry {
  organizationId: string;
  actorId: string | null;
  action: AuditAction;
  targetType: "user" | "invitation" | "booking" | "price_rule" | "task" | "ticket" | "listing" | "organization";
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
