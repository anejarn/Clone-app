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
 * The calendar synchronisation (Lot 7, lib/server/channels/): export links issued and revoked, import links set and
 * removed (host name only, never the URL), syncs asked by hand, every booking an import created, re-dated, adopted or
 * cancelled (actor null: the system), conflicts found and resolved, a listing's preparation days and notice.
 * The booking e-mails (Lot 7b, lib/server/channels/email/): the receiving address issued and revoked, every message
 * received (platform, kind, code, outcome — never the guest's name or the text), the bookings an e-mail created,
 * completed, re-dated or cancelled (actor null: the system, or the associé who dropped it), what an associé did with a
 * message of the queue; the platform's names of a home, the connection guide's ticks, the price reminders done.
 * The conciergerie (Lot 4b, lib/server/concierge/): partners and services created, changed (prices and settings, never the
 * texts in full nor the partner's contacts), deleted, a service's photo; every guest request received (service, date,
 * price snapshot — never the guest's phone or note), sent to the partner (channel, whether a provider delivered it),
 * every status change, final price set (from → to), payment recorded or taken back (method, amount).
 * Finances (Lot 6, lib/server/finance/): a split's inputs typed by an associé (gross, platform fee, exchange rate:
 * from → to) and its terms reapplied, every expense created, changed, deleted (drafts), validated, reversed (with the
 * reason) and its receipt added, months closed and reopened (with the reason), exports (filters and row count),
 * the finance settings and a home's financial terms, manual adjustments. The amounts themselves are in the journal
 * (financial_entries, append-only), which records the split of every booking write, system ones included.
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
  | "tourist_tax.report_exported"
  | "channel.export_link_issued"
  | "channel.export_link_revoked"
  | "channel.import_url_set"
  | "channel.import_url_removed"
  | "channel.sync_requested"
  | "channel.booking_imported"
  | "channel.booking_updated"
  | "channel.booking_adopted"
  | "channel.booking_cancelled"
  | "channel.conflict_detected"
  | "channel.conflict_resolved"
  | "listing.booking_rules_updated"
  | "channel.email_address_issued"
  | "channel.email_address_revoked"
  | "channel.email_received"
  | "channel.email_booking_created"
  | "channel.email_booking_updated"
  | "channel.email_booking_cancelled"
  | "channel.email_resolved"
  | "channel.listing_mapping_updated"
  | "channel.setup_checked"
  | "price_reminder.done"
  | "partner.created"
  | "partner.updated"
  | "partner.deleted"
  | "service.created"
  | "service.updated"
  | "service.deleted"
  | "service.photo_updated"
  | "service_request.created"
  | "service_request.sent"
  | "service_request.status_changed"
  | "service_request.price_set"
  | "service_request.payment_recorded"
  | "service_request.payment_cancelled"
  | "service_request.note_updated"
  | "finance.inputs_updated"
  | "finance.terms_reapplied"
  | "finance.month_closed"
  | "finance.month_reopened"
  | "finance.exported"
  | "finance.settings_updated"
  | "finance.listing_terms_updated"
  | "finance.adjustment_added"
  | "expense.created"
  | "expense.updated"
  | "expense.deleted"
  | "expense.validated"
  | "expense.reversed"
  | "expense.receipt_added";

export interface AuditEntry {
  organizationId: string;
  actorId: string | null;
  action: AuditAction;
  targetType: "user" | "invitation" | "booking" | "price_rule" | "task" | "ticket" | "listing" | "organization" | "channel_feed" | "channel_conflict" | "inbound_email" | "price_reminder" | "partner" | "service" | "service_request" | "expense" | "finance_month";
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
