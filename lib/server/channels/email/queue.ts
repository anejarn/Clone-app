import "server-only";
import type { BookingEntry } from "@/lib/admin/booking-form";
import { isoDay } from "@/lib/admin/calendar";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { BookingSource, InboundEmailKind, InboundEmailStatus, InboundEmailVia } from "@/lib/generated/prisma/enums";
import { decryptEmailDetails } from "@/lib/secrets/inbound-email";
import { SecretDecryptError } from "@/lib/secrets/envelope";
import { createStaffEntry } from "../../admin/bookings";
import { recordAudit } from "../../audit";
import type { Authorized } from "../../authz";
import { db } from "../../db";
import { AppError } from "../../errors";
import { notifyConflicts } from "../alerts";
import { ensureFeed } from "../feeds";
import { applyParsed, parsedFromRow, type EmailDetails } from "./process";

/**
 * « E-mails à traiter » (Synchronisation, ADMIN only, Lot 7b): the booking e-mails that couldn't be applied on their
 * own, and what an associé does with one — choose the home (and optionally remember the platform's name of it for the
 * next e-mails), apply it anyway (a failed DKIM check, a kind not recognized), create the booking by hand from what it
 * says, or ignore it. Every function takes the caller's organization: another organization's message is
 * « introuvable ». Every action is audited (channel.email_resolved).
 */

const notFound = () => new AppError(404, "NOT_FOUND", "E-mail introuvable.");

export interface InboundEmailView {
  id: string;
  via: InboundEmailVia;
  receivedAt: Date;
  status: InboundEmailStatus;
  reason: string | null;
  outcome: string | null;
  source: BookingSource | null;
  kind: InboundEmailKind;
  externalRef: string | null;
  checkIn: string | null;
  checkOut: string | null;
  senderDomain: string | null;
  listingId: string | null;
  listingTitle: string | null;
  bookingId: string | null;
  conflictId: string | null;
  resolvedAt: Date | null;
  /** Null once purged (or unreadable). */
  details: EmailDetails | null;
  purged: boolean;
}

const rowSelect = {
  id: true,
  organizationId: true,
  messageIdHash: true,
  via: true,
  receivedAt: true,
  status: true,
  reason: true,
  outcome: true,
  source: true,
  kind: true,
  externalRef: true,
  checkIn: true,
  checkOut: true,
  senderDomain: true,
  listingId: true,
  bookingId: true,
  conflictId: true,
  resolvedAt: true,
  detailsEnc: true,
  purgedAt: true,
} satisfies Prisma.InboundEmailSelect;

type Row = Prisma.InboundEmailGetPayload<{ select: typeof rowSelect }>;

function details(r: Row): EmailDetails | null {
  if (!r.detailsEnc) return null;
  try {
    return decryptEmailDetails<EmailDetails>(r.detailsEnc, { organizationId: r.organizationId, messageIdHash: r.messageIdHash });
  } catch (e) {
    if (!(e instanceof SecretDecryptError)) throw e;
    console.error(`details of inbound e-mail ${r.id} unreadable: ${e.message}`);
    return null;
  }
}

async function toViews(organizationId: string, rows: Row[]): Promise<InboundEmailView[]> {
  const ids = [...new Set(rows.map((r) => r.listingId).filter((x): x is string => !!x))];
  const titles = new Map((ids.length ? await db.listing.findMany({ where: { organizationId, id: { in: ids } }, select: { id: true, title: true } }) : []).map((l) => [l.id, l.title]));
  return rows.map((r) => ({
    id: r.id,
    via: r.via,
    receivedAt: r.receivedAt,
    status: r.status,
    reason: r.reason,
    outcome: r.outcome,
    source: r.source,
    kind: r.kind,
    externalRef: r.externalRef,
    checkIn: r.checkIn ? isoDay(r.checkIn) : null,
    checkOut: r.checkOut ? isoDay(r.checkOut) : null,
    senderDomain: r.senderDomain,
    listingId: r.listingId,
    listingTitle: r.listingId ? (titles.get(r.listingId) ?? null) : null,
    bookingId: r.bookingId,
    conflictId: r.conflictId,
    resolvedAt: r.resolvedAt,
    details: details(r),
    purged: !!r.purgedAt,
  }));
}

export type QueueFilter = "PENDING" | "PROCESSED" | "IGNORED";

export async function listInboundEmails(organizationId: string, filter: QueueFilter = "PENDING", take = 50): Promise<InboundEmailView[]> {
  const status: Prisma.InboundEmailWhereInput["status"] = filter === "PROCESSED" ? { in: ["PROCESSED", "DUPLICATE"] } : filter;
  const rows = await db.inboundEmail.findMany({ where: { organizationId, status }, select: rowSelect, orderBy: [{ receivedAt: "desc" }, { id: "desc" }], take });
  return toViews(organizationId, rows);
}

export async function getInboundEmail(organizationId: string, id: string): Promise<InboundEmailView | null> {
  const row = await db.inboundEmail.findFirst({ where: { id, organizationId }, select: rowSelect });
  return row ? (await toViews(organizationId, [row]))[0] : null;
}

export async function pendingEmailCount(organizationId: string): Promise<number> {
  return db.inboundEmail.count({ where: { organizationId, status: "PENDING" } });
}

async function pendingRow(tx: Prisma.TransactionClient, organizationId: string, id: string): Promise<Row> {
  const row = await tx.inboundEmail.findFirst({ where: { id, organizationId }, select: rowSelect });
  if (!row) throw notFound();
  if (row.status !== "PENDING") throw new AppError(409, "ALREADY_HANDLED", "Cet e-mail a déjà été traité.");
  return row;
}

async function close(tx: Prisma.TransactionClient, actor: Authorized, row: Row, data: Prisma.InboundEmailUncheckedUpdateInput, how: string, extra: Prisma.InputJsonObject = {}) {
  const r = await tx.inboundEmail.updateMany({ where: { id: row.id, organizationId: actor.organizationId, status: "PENDING" }, data });
  if (r.count === 0) throw new AppError(409, "ALREADY_HANDLED", "Cet e-mail a déjà été traité.");
  await recordAudit(tx, { organizationId: actor.organizationId, actorId: actor.user.id, action: "channel.email_resolved", targetType: "inbound_email", targetId: row.id, details: { how, source: row.source, externalRef: row.externalRef, ...extra } });
}

/**
 * Applies a waiting e-mail again, with the home chosen by the associé (optional when the home isn't the problem),
 * trusting it (a failed DKIM check, a kind not recognized). `remember`: the platform's id and title of the home read in
 * the e-mail are written on the home's feed for that platform, so the next e-mails are recognized.
 */
export async function applyPendingEmail(actor: Authorized, id: string, opts: { listingId?: string; remember?: boolean; today?: Date } = {}): Promise<{ status: InboundEmailStatus; outcome: string | null; reason: string | null; bookingId: string | null }> {
  const { organizationId } = actor;
  const { result, alert } = await db.$transaction(
    async (tx) => {
      const row = await pendingRow(tx, organizationId, id);
      const d = details(row);
      const parsed = parsedFromRow(row, d);
      if (opts.listingId) {
        const l = await tx.listing.findFirst({ where: { id: opts.listingId, organizationId, category: "HOME" }, select: { id: true } });
        if (!l) throw new AppError(404, "NOT_FOUND", "Bien introuvable.");
        if (opts.remember && parsed.platform && (parsed.listing.platformId || parsed.listing.name)) {
          const { feed } = await ensureFeed(tx, organizationId, l.id, parsed.platform);
          const mapping = {
            ...(parsed.listing.platformId && { platformListingId: parsed.listing.platformId.slice(0, 200) }),
            ...(parsed.listing.name && { platformListingName: parsed.listing.name.slice(0, 200) }),
          };
          await tx.channelFeed.update({ where: { id: feed.id }, data: mapping });
          await recordAudit(tx, { organizationId, actorId: actor.user.id, action: "channel.listing_mapping_updated", targetType: "listing", targetId: l.id, details: { source: parsed.platform, ...mapping, from: "email" } });
        }
      }
      const decision = await applyParsed(tx, parsed, { organizationId, actorId: actor.user.id, listingId: opts.listingId, trusted: true, today: opts.today });
      const resolved = decision.status !== "PENDING";
      await close(
        tx,
        actor,
        row,
        resolved
          ? { status: decision.status, reason: null, outcome: decision.outcome ?? null, listingId: decision.listingId ?? null, bookingId: decision.bookingId ?? null, conflictId: decision.conflictId ?? null, resolvedAt: new Date(), resolvedById: actor.user.id }
          : { status: "PENDING", reason: decision.reason ?? null, listingId: decision.listingId ?? row.listingId },
        "APPLIED",
        { status: decision.status, outcome: decision.outcome ?? null, reason: decision.reason ?? null, listingId: opts.listingId ?? null },
      );
      return { result: { status: decision.status, outcome: decision.outcome ?? null, reason: decision.reason ?? null, bookingId: decision.bookingId ?? null }, alert: decision.alert };
    },
    { timeout: 30_000, maxWait: 15_000 },
  );
  if (alert) await notifyConflicts(organizationId, [alert]);
  return result;
}

/** Creates the booking by hand from a waiting e-mail (Réservations' platform entry, same checks), and closes it. */
export async function createBookingFromEmail(actor: Authorized, id: string, entry: Extract<BookingEntry, { kind: "plateforme" }>): Promise<{ bookingId: string }> {
  const row = await db.inboundEmail.findFirst({ where: { id, organizationId: actor.organizationId }, select: { status: true } });
  if (!row) throw notFound();
  if (row.status !== "PENDING") throw new AppError(409, "ALREADY_HANDLED", "Cet e-mail a déjà été traité.");
  const { id: bookingId } = await createStaffEntry(actor, entry);
  // The booking is created (and audited) by Réservations' own function; then the message is closed. Should someone
  // have closed it meanwhile, the booking stays and the error says the message was already handled.
  await db.$transaction(async (tx) => {
    const r = await pendingRow(tx, actor.organizationId, id);
    await close(tx, actor, r, { status: "PROCESSED", reason: null, outcome: "CREATED_BY_HAND", listingId: entry.listingId, bookingId, resolvedAt: new Date(), resolvedById: actor.user.id }, "CREATED", { bookingId });
  });
  return { bookingId };
}

export async function ignoreEmail(actor: Authorized, id: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const row = await pendingRow(tx, actor.organizationId, id);
    await close(tx, actor, row, { status: "IGNORED", reason: "IGNORED_BY_HAND", resolvedAt: new Date(), resolvedById: actor.user.id }, "IGNORED");
  });
}

/** The homes an associé can choose, for the queue's select. */
export async function queueListingOptions(organizationId: string) {
  return db.listing.findMany({ where: { organizationId, category: "HOME" }, select: { id: true, title: true }, orderBy: [{ title: "asc" }, { id: "asc" }] });
}
