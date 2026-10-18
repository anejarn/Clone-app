import "server-only";
import { platformAmounts, ENTRY_LIMITS } from "@/lib/admin/booking-form";
import { isPlatformSource, type PlatformSource } from "@/lib/admin/booking-sources";
import { addDays, isoDay } from "@/lib/admin/calendar";
import { contentKey, matchListing, messageKey, parseBookingEmail, rawHash, type ParsedBookingEmail } from "@/lib/channels/email";
import { todayInTimeZone } from "@/lib/dates";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { BookingSource, InboundEmailKind, InboundEmailStatus, InboundEmailVia } from "@/lib/generated/prisma/enums";
import { syncBookingTasks } from "@/lib/operations/sync";
import { nightsBetween } from "@/lib/pricing";
import { encryptEmailDetails, encryptRawEmail } from "@/lib/secrets/inbound-email";
import { recordAudit } from "../../audit";
import { db } from "../../db";
import { refreshExistingBookingTax } from "../../declarations/tax";
import { AppError } from "../../errors";
import { notifyConflicts, notifyEmailQueue, type ConflictAlert } from "../alerts";
import { ensureFeed } from "../feeds";

/**
 * Processing of a platform's booking e-mail (Lot 7b), from the webhook (POST /api/inbound-email/<token>), a pull
 * source (worker) or « Déposer un e-mail ». In one transaction holding the home's advisory lock (the same as the iCal
 * imports, so an e-mail and a feed of one home are applied one after the other):
 *
 * - confirmation → the booking is created AT ONCE (source = the platform, externalRef = its code, no feed), which
 *   blocks the dates everywhere (bookings_no_overlap, every export); if the iCal import already made a placeholder for
 *   the same nights (same platform, from a feed, no code yet), that one is completed instead: it takes the code
 *   (externalRef) and keeps the feed's reference (channelEventRef), so the next import still matches it; the other way
 *   round, an import finding the e-mail's booking on exactly its nights adopts it (lib/channels/reconcile.ts);
 * - modification → the booking with that platform and code is re-dated and completed;
 * - cancellation → the booking with that platform and code is cancelled (only that one; never a stay started: queue);
 * - guest name, guests and the platform's amount (platformAmount*, with its kind and currency; a MAD amount also
 *   fills totalCents when the booking had none) complete the booking; field tasks and the taxe de séjour follow;
 * - nights already taken → a ChannelConflict (origin EMAIL) like an import, notified, exported as busy;
 * - anything not certain (unknown platform, home not recognized or ambiguous, code or dates unreadable, a failed
 *   DKIM/DMARC check, the cancellation of a booking Sigma doesn't have) → PENDING in « E-mails à traiter », notified;
 *   spam and guest messages → IGNORED.
 * Idempotent: one row per (organization, Message-ID) — a message received again returns the first outcome —, the
 * same content forwarded again is a DUPLICATE, and re-applying an e-mail to its booking changes nothing. Every
 * message and every change is audited (codes and outcomes, never the guest's name or the text).
 */

export const MAX_EMAIL_BYTES = 5 * 1024 * 1024;

/** What is kept encrypted (detailsEnc) besides the clear columns. */
export interface EmailDetails {
  subject: string;
  fromAddress: string | null;
  guestName: string | null;
  adults: number | null;
  children: number | null;
  infants: number | null;
  amount: ParsedBookingEmail["amount"];
  listing: ParsedBookingEmail["listing"];
  forwarded: boolean;
  bookingLike: boolean;
  authFailed: boolean;
  missing: string[];
  date: string | null;
  excerpt: string;
  /** Homes that matched (AMBIGUOUS_LISTING). */
  candidates?: string[];
}

export interface Decision {
  status: InboundEmailStatus;
  reason?: string | null;
  outcome?: string | null;
  listingId?: string | null;
  bookingId?: string | null;
  conflictId?: string | null;
  candidates?: string[];
  alert?: ConflictAlert;
}

export interface IngestResult {
  id: string;
  status: InboundEmailStatus;
  reason: string | null;
  outcome: string | null;
  bookingId: string | null;
  duplicate: boolean;
}

const pending = (reason: string, extra: Partial<Decision> = {}): Decision => ({ status: "PENDING", reason, ...extra });
const processed = (outcome: string, extra: Partial<Decision> = {}): Decision => ({ status: "PROCESSED", outcome, ...extra });
const asDay = (s: string) => new Date(`${s}T00:00:00Z`);

function isOverlapViolation(e: unknown): boolean {
  const text = e instanceof Error ? `${e.message} ${JSON.stringify((e as { meta?: unknown }).meta ?? "")}` : "";
  return text.includes("bookings_no_overlap") || text.includes("23P01") || text.includes("40P01");
}

const isUniqueViolation = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";

export function detailsOf(p: ParsedBookingEmail, candidates?: string[]): EmailDetails {
  return {
    subject: p.subject,
    fromAddress: p.fromAddress,
    guestName: p.guestName,
    adults: p.adults,
    children: p.children,
    infants: p.infants,
    amount: p.amount,
    listing: p.listing,
    forwarded: p.forwarded,
    bookingLike: p.bookingLike,
    authFailed: p.authFailed,
    missing: p.missing,
    date: p.date,
    excerpt: p.excerpt,
    ...(candidates?.length && { candidates }),
  };
}

/** A stored message back in the shape of a parsed one (the queue's actions re-apply it). */
export function parsedFromRow(
  row: { source: string | null; kind: InboundEmailKind; externalRef: string | null; checkIn: Date | null; checkOut: Date | null; senderDomain: string | null },
  d: EmailDetails | null,
): ParsedBookingEmail {
  return {
    platform: row.source && isPlatformSource(row.source) ? row.source : null,
    kind: row.kind,
    code: row.externalRef,
    guestName: d?.guestName ?? null,
    checkIn: row.checkIn ? isoDay(row.checkIn) : null,
    checkOut: row.checkOut ? isoDay(row.checkOut) : null,
    adults: d?.adults ?? null,
    children: d?.children ?? null,
    infants: d?.infants ?? null,
    amount: d?.amount ?? null,
    listing: d?.listing ?? { platformId: null, name: null },
    forwarded: d?.forwarded ?? false,
    bookingLike: d?.bookingLike ?? true,
    authFailed: d?.authFailed ?? false,
    missing: d?.missing ?? [],
    subject: d?.subject ?? "",
    fromAddress: d?.fromAddress ?? null,
    senderDomain: row.senderDomain,
    messageId: null,
    date: d?.date ?? null,
    excerpt: d?.excerpt ?? "",
  };
}

const bookingSelect = {
  id: true,
  listingId: true,
  source: true,
  status: true,
  externalRef: true,
  channelFeedId: true,
  channelBlock: true,
  checkIn: true,
  checkOut: true,
  guestName: true,
  adults: true,
  children: true,
  infants: true,
  totalCents: true,
  platformAmountCents: true,
  platformCurrency: true,
} satisfies Prisma.BookingSelect;

type BookingRow = Prisma.BookingGetPayload<{ select: typeof bookingSelect }>;

/** What an e-mail adds to a booking: guest name, guests, the platform's amount (and a MAD total when none yet). */
export function enrichment(b: Pick<BookingRow, "guestName" | "adults" | "children" | "infants" | "totalCents" | "platformAmountCents" | "platformCurrency" | "channelBlock">, p: ParsedBookingEmail, nights: number, overwriteName: boolean): Prisma.BookingUncheckedUpdateInput {
  const data: Prisma.BookingUncheckedUpdateInput = {};
  if (p.guestName && (overwriteName || !b.guestName) && p.guestName !== b.guestName) data.guestName = p.guestName.slice(0, ENTRY_LIMITS.name);
  if (p.adults !== null && p.adults > 0) {
    const adults = Math.min(p.adults, ENTRY_LIMITS.guests);
    const children = Math.min(p.children ?? 0, ENTRY_LIMITS.guests);
    if (adults !== b.adults) data.adults = adults;
    if (children !== b.children) data.children = children;
    if (p.infants !== null && p.infants !== b.infants) data.infants = Math.min(p.infants, ENTRY_LIMITS.infants);
  }
  if (p.amount && p.amount.cents > 0 && p.amount.cents <= ENTRY_LIMITS.maxAmountCents) {
    if (p.amount.cents !== b.platformAmountCents || p.amount.currency !== b.platformCurrency) {
      Object.assign(data, { platformAmountCents: p.amount.cents, platformCurrency: p.amount.currency, platformAmountKind: p.amount.kind });
    }
    // A MAD amount fills the booking's own total when it has none, or when its total came from an earlier e-mail.
    const fromEmail = b.platformCurrency === "MAD" && b.platformAmountCents !== null && b.platformAmountCents === b.totalCents;
    if (p.amount.currency === "MAD" && (b.totalCents === null || fromEmail) && b.totalCents !== p.amount.cents && nights > 0) {
      const a = platformAmounts(p.amount.cents, 0, nights);
      Object.assign(data, { nightlyCents: a.nightlyCents, cleaningFeeCents: a.cleaningFeeCents, serviceFeeCents: a.serviceFeeCents, totalCents: a.totalCents });
    }
  }
  if (b.channelBlock) data.channelBlock = false;
  return data;
}

interface ApplyOptions {
  organizationId: string;
  actorId: string | null;
  /** The home chosen by an associé (manual queue). */
  listingId?: string;
  /** Applied by an associé: a failed DKIM check or an unknown kind with a code and dates no longer stop it. */
  trusted?: boolean;
  today?: Date;
}

async function lockListing(tx: Prisma.TransactionClient, organizationId: string, listingId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`sigma:listing:${listingId}`}, 0))`;
  return tx.listing.findFirst({ where: { id: listingId, organizationId, category: "HOME" }, select: { id: true, title: true, place: { select: { timezone: true } } } });
}

/** Decides and applies what an e-mail changes, inside the caller's transaction. */
export async function applyParsed(tx: Prisma.TransactionClient, p: ParsedBookingEmail, o: ApplyOptions): Promise<Decision> {
  const { organizationId, actorId } = o;
  if (p.authFailed && !o.trusted) return pending("AUTH_FAILED");
  if (!p.platform) return p.bookingLike || o.trusted ? pending("NOT_RECOGNIZED") : { status: "IGNORED", reason: "NOT_A_BOOKING" };
  const kind = p.kind === "UNKNOWN" && o.trusted ? "CONFIRMATION" : p.kind;
  if (kind === "UNKNOWN") return p.code && p.checkIn && p.checkOut ? pending("UNKNOWN_KIND") : { status: "IGNORED", reason: "NOT_A_RESERVATION" };
  if (!p.code) return pending("MISSING_FIELDS");
  const source: PlatformSource = p.platform;
  const code = p.code;
  const audit = (action: Parameters<typeof recordAudit>[1]["action"], targetType: "booking" | "channel_conflict", targetId: string, details: Prisma.InputJsonObject) =>
    recordAudit(tx, { organizationId, actorId, action, targetType, targetId, details: { source, externalRef: code, via: "email", ...details } });
  const findByCode = () => tx.booking.findFirst({ where: { organizationId, source, externalRef: code }, select: bookingSelect });

  // ---------- Cancellation: only the booking of that platform and code ----------
  if (kind === "CANCELLATION") {
    const first = await findByCode();
    if (!first) {
      const open = await tx.channelConflict.findMany({ where: { organizationId, source, externalRef: code, status: "OPEN", origin: "EMAIL" }, select: { id: true, listingId: true } });
      if (!open.length) return pending("NO_BOOKING");
      for (const c of open) {
        await tx.channelConflict.update({ where: { id: c.id }, data: { status: "RESOLVED", resolution: "EVENT_GONE", resolvedAt: new Date() } });
        await audit("channel.conflict_resolved", "channel_conflict", c.id, { resolution: "EVENT_GONE" });
      }
      return processed("CONFLICT_CLOSED", { listingId: open[0].listingId, conflictId: open[0].id });
    }
    const listing = await lockListing(tx, organizationId, first.listingId);
    const b = await findByCode();
    if (!listing || !b) return pending("NO_BOOKING");
    const today = o.today ?? todayInTimeZone(listing.place.timezone);
    if (b.status === "CANCELLED") return processed("UNCHANGED", { listingId: b.listingId, bookingId: b.id });
    if (b.checkOut <= today) return processed("PAST", { listingId: b.listingId, bookingId: b.id });
    if (b.checkIn < today && !o.trusted) return pending("STARTED", { listingId: b.listingId, bookingId: b.id });
    await tx.booking.update({ where: { id: b.id, status: "CONFIRMED" }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    await syncBookingTasks(tx, b.id, { today });
    await audit("channel.email_booking_cancelled", "booking", b.id, { checkIn: isoDay(b.checkIn), checkOut: isoDay(b.checkOut) });
    // Its conflicts as « own » booking are over.
    for (const c of await tx.channelConflict.findMany({ where: { ownBookingId: b.id, status: "OPEN" }, select: { id: true } })) {
      await tx.channelConflict.update({ where: { id: c.id }, data: { status: "RESOLVED", resolution: "EVENT_GONE", resolvedAt: new Date() } });
      await audit("channel.conflict_resolved", "channel_conflict", c.id, { resolution: "EVENT_GONE" });
    }
    return processed("CANCELLED", { listingId: b.listingId, bookingId: b.id });
  }

  // ---------- Confirmation, modification ----------
  if (!p.checkIn || !p.checkOut) return pending("MISSING_FIELDS");
  const checkIn = asDay(p.checkIn);
  const checkOut = asDay(p.checkOut);
  const nights = nightsBetween(checkIn, checkOut);
  if (nights < 1 || nights > ENTRY_LIMITS.maxNights) return pending("INVALID_DATES");
  const known = await findByCode();
  if (known && o.listingId && known.listingId !== o.listingId) return pending("REF_ELSEWHERE", { listingId: known.listingId, bookingId: known.id });
  let listingId = known?.listingId ?? o.listingId ?? null;
  if (!listingId) {
    const homes = await tx.listing.findMany({
      where: { organizationId, category: "HOME" },
      select: { id: true, title: true, channelFeeds: { select: { source: true, platformListingId: true, platformListingName: true } } },
    });
    const m = matchListing(
      homes.map((h) => ({ listingId: h.id, title: h.title, feeds: h.channelFeeds.flatMap((f) => (isPlatformSource(f.source) ? [{ ...f, source: f.source }] : [])) })),
      source,
      p.listing,
    );
    if (m.kind === "none") return pending("NO_LISTING");
    if (m.kind === "ambiguous") return pending("AMBIGUOUS_LISTING", { candidates: m.listingIds });
    listingId = m.listingId;
  }
  const listing = await lockListing(tx, organizationId, listingId);
  if (!listing) return pending("NO_LISTING");
  const today = o.today ?? todayInTimeZone(listing.place.timezone);
  if (checkOut <= today) return processed("PAST", { listingId });
  if (checkIn > addDays(today, ENTRY_LIMITS.windowDays)) return pending("INVALID_DATES", { listingId });
  const nightsOf = (b: { checkIn: Date; checkOut: Date }) => ({ checkIn: isoDay(b.checkIn), checkOut: isoDay(b.checkOut) });
  const clashWith = (excludeId?: string) =>
    tx.booking.findFirst({
      where: { organizationId, listingId: listing.id, status: "CONFIRMED", checkIn: { lt: checkOut }, checkOut: { gt: checkIn }, ...(excludeId && { id: { not: excludeId } }) },
      select: { id: true, source: true, externalRef: true, checkIn: true, checkOut: true },
      orderBy: { checkIn: "asc" },
    });

  const recordConflict = async (blocker: { id: string; source: BookingSource; externalRef: string | null; checkIn: Date; checkOut: Date }, ownBookingId: string | null): Promise<Decision> => {
    const { feed } = await ensureFeed(tx, organizationId, listing.id, source);
    const data = {
      checkIn,
      checkOut,
      block: false,
      blockingBookingId: blocker.id,
      blockingSource: blocker.source,
      blockingRef: blocker.externalRef,
      blockingCheckIn: blocker.checkIn,
      blockingCheckOut: blocker.checkOut,
      ownBookingId,
      lastSeenAt: new Date(),
    };
    const open = await tx.channelConflict.findFirst({ where: { feedId: feed.id, externalRef: code, status: "OPEN" }, select: { id: true, checkIn: true, checkOut: true } });
    const alert: ConflictAlert = { listingTitle: listing.title, source, checkIn, checkOut, blockingSource: blocker.source, blockingRef: blocker.externalRef };
    if (open) {
      await tx.channelConflict.update({ where: { id: open.id }, data });
      const same = open.checkIn.getTime() === checkIn.getTime() && open.checkOut.getTime() === checkOut.getTime();
      if (!same) await audit("channel.conflict_detected", "channel_conflict", open.id, { checkIn: p.checkIn!, checkOut: p.checkOut!, redated: true });
      return processed("CONFLICT", { listingId: listing.id, conflictId: open.id, bookingId: ownBookingId, ...(!same && { alert }) });
    }
    const c = await tx.channelConflict.create({ data: { organizationId, listingId: listing.id, feedId: feed.id, source, externalRef: code, origin: "EMAIL", ...data }, select: { id: true } });
    await audit("channel.conflict_detected", "channel_conflict", c.id, { checkIn: p.checkIn!, checkOut: p.checkOut!, blockingBookingId: blocker.id, blockingSource: blocker.source });
    return processed("CONFLICT", { listingId: listing.id, conflictId: c.id, bookingId: ownBookingId, alert });
  };
  const closeEmailConflicts = async (bookingId: string) => {
    for (const c of await tx.channelConflict.findMany({ where: { organizationId, listingId: listing.id, source, externalRef: code, status: "OPEN", origin: "EMAIL" }, select: { id: true } })) {
      await tx.channelConflict.update({ where: { id: c.id }, data: { status: "RESOLVED", resolution: "FREED", resolvedAt: new Date() } });
      await audit("channel.conflict_resolved", "channel_conflict", c.id, { resolution: "FREED", bookingId });
    }
  };

  // The booking of that code: re-dated, reactivated, completed.
  const b = known ? await findByCode() : null;
  if (b) {
    const sameNights = b.checkIn.getTime() === checkIn.getTime() && b.checkOut.getTime() === checkOut.getTime();
    if (b.status === "CONFIRMED" && sameNights) {
      const data = enrichment(b, p, nights, kind === "MODIFICATION");
      if (!Object.keys(data).length) return processed("UNCHANGED", { listingId: b.listingId, bookingId: b.id });
      await tx.booking.update({ where: { id: b.id }, data });
      if (b.channelBlock) await syncBookingTasks(tx, b.id, { today });
      await audit("channel.email_booking_updated", "booking", b.id, { fields: Object.keys(data).sort(), ...nightsOf(b) });
      return processed("ENRICHED", { listingId: b.listingId, bookingId: b.id });
    }
    const clash = await clashWith(b.id);
    if (clash) return recordConflict(clash, b.status === "CONFIRMED" ? b.id : null);
    const data = { ...enrichment(b, p, nights, true), checkIn, checkOut, status: "CONFIRMED" as const, cancelledAt: null };
    await tx.booking.update({ where: { id: b.id }, data });
    await syncBookingTasks(tx, b.id, { today, previous: { checkIn: b.checkIn, checkOut: b.checkOut } });
    await refreshExistingBookingTax(tx, organizationId, b.id, actorId);
    await closeEmailConflicts(b.id);
    const outcome = b.status === "CANCELLED" ? "REACTIVATED" : "REDATED";
    await audit("channel.email_booking_updated", "booking", b.id, { from: nightsOf(b), to: { checkIn: p.checkIn, checkOut: p.checkOut }, ...(outcome === "REACTIVATED" && { reactivated: true }) });
    return processed(outcome, { listingId: b.listingId, bookingId: b.id });
  }

  // The iCal import's placeholder of these nights (same platform, from a feed, no code yet): completed.
  const placeholder = await tx.booking.findFirst({
    where: { organizationId, listingId: listing.id, source, status: "CONFIRMED", channelFeedId: { not: null }, channelEventRef: null, NOT: { externalRef: code }, checkIn, checkOut },
    select: bookingSelect,
  });
  if (placeholder) {
    const data = { ...enrichment(placeholder, p, nights, true), externalRef: code, channelEventRef: placeholder.externalRef };
    await tx.booking.update({ where: { id: placeholder.id }, data });
    await syncBookingTasks(tx, placeholder.id, { today });
    await closeEmailConflicts(placeholder.id);
    await audit("channel.email_booking_updated", "booking", placeholder.id, { completedPlaceholder: true, fields: Object.keys(data).sort(), ...nightsOf(placeholder) });
    return processed("ENRICHED", { listingId: listing.id, bookingId: placeholder.id });
  }

  const clash = await clashWith();
  if (clash) return recordConflict(clash, null);
  const extra = enrichment({ guestName: null, adults: 1, children: 0, infants: 0, totalCents: null, platformAmountCents: null, platformCurrency: null, channelBlock: false }, p, nights, true) as Partial<Prisma.BookingUncheckedCreateInput>;
  const created = await tx.booking.create({
    data: { organizationId, listingId: listing.id, source, externalRef: code, checkIn, checkOut, adults: 1, ...extra },
    select: { id: true },
  });
  await syncBookingTasks(tx, created.id, { today });
  await closeEmailConflicts(created.id);
  await audit("channel.email_booking_created", "booking", created.id, { checkIn: p.checkIn, checkOut: p.checkOut, nights, ...(p.amount && { amountCents: p.amount.cents, currency: p.amount.currency, amountKind: p.amount.kind }) });
  return processed("CREATED", { listingId: listing.id, bookingId: created.id });
}

export interface IngestInput {
  organizationId: string;
  raw: Uint8Array;
  via: InboundEmailVia;
  actorId?: string | null;
  now?: Date;
  /** Local date (tests). Default: today at the home. */
  today?: Date;
}

function readSafely(raw: Uint8Array, now: Date): ParsedBookingEmail {
  try {
    return parseBookingEmail(raw, now);
  } catch (e) {
    console.error(`booking e-mail unreadable: ${(e as Error).message}`);
    return {
      platform: null, kind: "UNKNOWN", code: null, guestName: null, checkIn: null, checkOut: null, adults: null, children: null, infants: null, amount: null,
      listing: { platformId: null, name: null }, forwarded: false, bookingLike: true, authFailed: false, missing: ["code", "checkIn", "checkOut"],
      subject: "", fromAddress: null, senderDomain: null, messageId: null, date: null, excerpt: "",
    };
  }
}

/** Receives one message for an organization: stores it (encrypted), applies it, notifies. */
export async function ingestInboundEmail(input: IngestInput): Promise<IngestResult> {
  const { organizationId, raw } = input;
  if (raw.byteLength === 0) throw new AppError(400, "EMPTY", "Message vide.");
  if (raw.byteLength > MAX_EMAIL_BYTES) throw new AppError(413, "PAYLOAD_TOO_LARGE", "Message trop volumineux (5 Mo au maximum).");
  const now = input.now ?? new Date();
  const parsed = readSafely(raw, now);
  const rawSha256 = rawHash(raw);
  const messageIdHash = messageKey(parsed.messageId, rawSha256);
  const asResult = (r: { id: string; status: InboundEmailStatus; reason: string | null; outcome: string | null; bookingId: string | null }, duplicate: boolean): IngestResult => ({ ...r, duplicate });
  const resultSelect = { id: true, status: true, reason: true, outcome: true, bookingId: true } as const;
  const seen = await db.inboundEmail.findUnique({ where: { organizationId_messageIdHash: { organizationId, messageIdHash } }, select: resultSelect });
  if (seen) return asResult(seen, true);
  const ck = contentKey(parsed);
  const encCtx = { organizationId, messageIdHash };
  const base = {
    organizationId,
    via: input.via,
    receivedAt: now,
    messageIdHash,
    rawSha256,
    contentKey: ck,
    sizeBytes: raw.byteLength,
    senderDomain: parsed.senderDomain?.slice(0, 253) ?? null,
    source: parsed.platform,
    kind: parsed.kind,
    externalRef: parsed.code?.slice(0, 64) ?? null,
    checkIn: parsed.checkIn ? asDay(parsed.checkIn) : null,
    checkOut: parsed.checkIn && parsed.checkOut && parsed.checkOut > parsed.checkIn ? asDay(parsed.checkOut) : null,
    rawEnc: encryptRawEmail(raw, encCtx),
    createdById: input.actorId ?? null,
  };

  for (let attempt = 0; ; attempt++) {
    try {
      const { row, decision } = await db.$transaction(
        async (tx) => {
          const prior = ck ? await tx.inboundEmail.findFirst({ where: { organizationId, contentKey: ck, status: "PROCESSED" }, select: { id: true, listingId: true, bookingId: true }, orderBy: { receivedAt: "asc" } }) : null;
          const decision: Decision = prior ? { status: "DUPLICATE", outcome: "SAME_CONTENT", listingId: prior.listingId, bookingId: prior.bookingId } : await applyParsed(tx, parsed, { organizationId, actorId: input.actorId ?? null, today: input.today });
          const row = await tx.inboundEmail.create({
            data: {
              ...base,
              status: decision.status,
              reason: decision.reason ?? null,
              outcome: decision.outcome ?? null,
              listingId: decision.listingId ?? null,
              bookingId: decision.bookingId ?? null,
              conflictId: decision.conflictId ?? null,
              detailsEnc: encryptEmailDetails(detailsOf(parsed, decision.candidates), encCtx),
            },
            select: resultSelect,
          });
          await recordAudit(tx, {
            organizationId,
            actorId: input.actorId ?? null,
            action: "channel.email_received",
            targetType: "inbound_email",
            targetId: row.id,
            details: { via: input.via, source: parsed.platform, kind: parsed.kind, externalRef: base.externalRef, status: decision.status, reason: decision.reason ?? null, outcome: decision.outcome ?? null, bookingId: decision.bookingId ?? null },
          });
          return { row, decision };
        },
        { timeout: 30_000, maxWait: 15_000 },
      );
      if (decision.alert) await notifyConflicts(organizationId, [decision.alert]);
      if (decision.status === "PENDING") await notifyEmailQueue(organizationId, [{ source: parsed.platform, reason: decision.reason ?? "NOT_RECOGNIZED" }]);
      return asResult(row, false);
    } catch (e) {
      // The same message received twice at once: the first one's outcome.
      if (isUniqueViolation(e)) {
        const again = await db.inboundEmail.findUnique({ where: { organizationId_messageIdHash: { organizationId, messageIdHash } }, select: resultSelect });
        if (again) return asResult(again, true);
      }
      // A booking typed meanwhile took the nights: read again, the conflict is then seen.
      if (attempt === 0 && isOverlapViolation(e)) continue;
      throw e;
    }
  }
}
