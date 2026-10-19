import "server-only";
import { allowedMoves, canSeePartnerPrices, checkMove, OPEN_REQUEST_STATUSES, paymentRecordable, priceEditable, requestReference, REQUEST_STATUS_LABEL, statusTimestamps } from "@/lib/concierge/catalog";
import { readServiceOptions, type FinalPriceInput } from "@/lib/concierge/form";
import { buildPartnerMessage, partnerMailtoLink, partnerMessageSubject, partnerWhatsappLink } from "@/lib/concierge/partner-message";
import { marginBps, marginOf } from "@/lib/concierge/pricing";
import { todayInTimeZone } from "@/lib/dates";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { PartnerChannel, ServiceCategory, ServicePaymentMethod, ServicePricingModel, ServiceRequestStatus } from "@/lib/generated/prisma/enums";
import { MARRAKECH_TIMEZONE } from "@/lib/neighbourhoods";
import { notifier } from "@/lib/notifications";
import { recordAudit } from "../audit";
import type { Authorized } from "../authz";
import { db } from "../db";
import { AppError } from "../errors";

/**
 * Guests' service requests in the back-office (Conciergerie → Demandes, associés only): the list, a request's detail,
 * « Envoyer au partenaire » (the prefilled WhatsApp / e-mail message: lib/concierge/partner-message.ts, also handed to
 * lib/notifications, which delivers nothing until a provider is chosen), status changes (lib/concierge/catalog.ts),
 * the final price before confirmation, the payment on the spot (cash recorded for traceability). Every function takes
 * the caller and only touches their organization's rows (another organization's request: 404); every change is
 * audited in its transaction, the request's row locked first.
 */

const requestNotFound = () => new AppError(404, "NOT_FOUND", "Demande introuvable.");
export const REQUEST_LIST_LIMIT = 300;

function requireManager(actor: Authorized) {
  if (!canSeePartnerPrices(actor.user.role)) throw new AppError(403, "FORBIDDEN", "Accès refusé.");
}

const listSelect = {
  id: true,
  status: true,
  serviceDate: true,
  startMinutes: true,
  scheduledAt: true,
  quantity: true,
  persons: true,
  titleSnapshot: true,
  category: true,
  pricingModel: true,
  saleTotalCents: true,
  partnerTotalCents: true,
  marginCents: true,
  priceAdjusted: true,
  paymentMethod: true,
  paidAt: true,
  sentAt: true,
  sentVia: true,
  createdAt: true,
  partner: { select: { id: true, name: true } },
  booking: { select: { id: true, guestName: true, checkIn: true, checkOut: true, guest: { select: { name: true } }, listing: { select: { id: true, title: true } } } },
} satisfies Prisma.ServiceRequestSelect;

type ListRow = Prisma.ServiceRequestGetPayload<{ select: typeof listSelect }>;

export interface RequestView {
  id: string;
  reference: string;
  status: ServiceRequestStatus;
  serviceDate: string;
  startMinutes: number;
  quantity: number;
  persons: number;
  title: string;
  category: ServiceCategory;
  pricingModel: ServicePricingModel;
  saleTotalCents: number | null;
  partnerTotalCents: number | null;
  marginCents: number | null;
  marginBps: number | null;
  priceAdjusted: boolean;
  paymentMethod: ServicePaymentMethod | null;
  paidAt: string | null;
  sentAt: string | null;
  sentVia: PartnerChannel | null;
  createdAt: string;
  partner: { id: string; name: string };
  booking: { id: string; guestName: string | null; checkIn: string; checkOut: string; listing: { id: string; title: string } };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

function toView(r: ListRow): RequestView {
  return {
    id: r.id,
    reference: requestReference(r.id),
    status: r.status,
    serviceDate: iso(r.serviceDate),
    startMinutes: r.startMinutes,
    quantity: r.quantity,
    persons: r.persons,
    title: r.titleSnapshot,
    category: r.category,
    pricingModel: r.pricingModel,
    saleTotalCents: r.saleTotalCents,
    partnerTotalCents: r.partnerTotalCents,
    marginCents: r.marginCents,
    marginBps: r.saleTotalCents !== null && r.marginCents !== null ? marginBps(r.saleTotalCents, r.marginCents) : null,
    priceAdjusted: r.priceAdjusted,
    paymentMethod: r.paymentMethod,
    paidAt: r.paidAt?.toISOString() ?? null,
    sentAt: r.sentAt?.toISOString() ?? null,
    sentVia: r.sentVia,
    createdAt: r.createdAt.toISOString(),
    partner: r.partner,
    booking: {
      id: r.booking.id,
      guestName: r.booking.guest?.name ?? r.booking.guestName,
      checkIn: iso(r.booking.checkIn),
      checkOut: iso(r.booking.checkOut),
      listing: r.booking.listing,
    },
  };
}

export interface RequestFilters {
  /** "OPEN_ANY" (default: new, sent, confirmed), "ALL", or one status. */
  status?: ServiceRequestStatus | "OPEN_ANY" | "ALL";
  category?: ServiceCategory;
}

/** The organization's requests: the soonest service first. */
export async function listRequests(actor: Authorized, f: RequestFilters = {}): Promise<{ items: RequestView[]; truncated: boolean }> {
  requireManager(actor);
  const status = f.status ?? "OPEN_ANY";
  const rows = await db.serviceRequest.findMany({
    where: {
      organizationId: actor.organizationId,
      ...(status === "OPEN_ANY" ? { status: { in: [...OPEN_REQUEST_STATUSES] } } : status === "ALL" ? {} : { status }),
      ...(f.category && { category: f.category }),
    },
    select: listSelect,
    orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
    take: REQUEST_LIST_LIMIT + 1,
  });
  return { items: rows.slice(0, REQUEST_LIST_LIMIT).map(toView), truncated: rows.length > REQUEST_LIST_LIMIT };
}

export interface RequestDetail extends RequestView {
  options: { id: string; label: string; saleCents: number; partnerCents: number; perUnit: boolean }[];
  unitSaleCents: number | null;
  unitPartnerCents: number | null;
  guestNote: string;
  contactPhone: string;
  guestLocale: string;
  internalNote: string;
  confirmedAt: string | null;
  doneAt: string | null;
  cancelledAt: string | null;
  refusedAt: string | null;
  partnerContact: { phone: string | null; whatsapp: string | null; email: string | null; preferredChannel: PartnerChannel; active: boolean };
  /** The prefilled message and its links (null when the partner has no such contact). */
  send: { subject: string; text: string; whatsapp: string | null; mailto: string | null; tel: string | null };
  can: { moves: ServiceRequestStatus[]; send: boolean; editPrice: boolean; recordPayment: boolean; cancelPayment: boolean };
}

/** One request with what « Envoyer au partenaire » needs, or null when it isn't the caller's organization's. */
export async function getRequest(actor: Authorized, id: string): Promise<RequestDetail | null> {
  requireManager(actor);
  const r = await db.serviceRequest.findFirst({
    where: { id, organizationId: actor.organizationId },
    select: {
      ...listSelect,
      options: true,
      unitSaleCents: true,
      unitPartnerCents: true,
      guestNote: true,
      contactPhone: true,
      guestLocale: true,
      internalNote: true,
      confirmedAt: true,
      doneAt: true,
      cancelledAt: true,
      refusedAt: true,
      partner: { select: { id: true, name: true, phone: true, whatsapp: true, email: true, preferredChannel: true, active: true } },
      booking: {
        select: {
          id: true,
          guestName: true,
          checkIn: true,
          checkOut: true,
          guest: { select: { name: true } },
          listing: { select: { id: true, title: true, address: true, city: true, place: { select: { name: true } } } },
        },
      },
      organization: { select: { name: true } },
    },
  });
  if (!r) return null;
  const options = readServiceOptions(r.options).map((o) => ({ id: o.id, label: o.label.fr ?? "", saleCents: o.saleCents, partnerCents: o.partnerCents, perUnit: o.perUnit }));
  const guestName = r.booking.guest?.name ?? r.booking.guestName;
  const msg = {
    organizationName: r.organization.name,
    partnerName: r.partner.name,
    reference: requestReference(r.id),
    title: r.titleSnapshot,
    serviceDate: r.serviceDate,
    startMinutes: r.startMinutes,
    pricingModel: r.pricingModel,
    quantity: r.quantity,
    persons: r.persons,
    options: options.map((o) => o.label),
    place: { address: r.booking.listing.address, placeName: r.booking.listing.place.name, city: r.booking.listing.city },
    guestFirstName: guestName?.trim().split(/\s+/)[0] || null,
    contactPhone: r.contactPhone,
    guestNote: r.guestNote,
    partnerTotalCents: r.partnerTotalCents,
  };
  const text = buildPartnerMessage(msg);
  const subject = partnerMessageSubject(msg);
  const p = r.partner;
  const sendable = r.status === "NEW" || r.status === "SENT_TO_PARTNER";
  return {
    ...toView({ ...r, booking: { ...r.booking, listing: { id: r.booking.listing.id, title: r.booking.listing.title } } }),
    options,
    unitSaleCents: r.unitSaleCents,
    unitPartnerCents: r.unitPartnerCents,
    guestNote: r.guestNote,
    contactPhone: r.contactPhone,
    guestLocale: r.guestLocale,
    internalNote: r.internalNote,
    confirmedAt: r.confirmedAt?.toISOString() ?? null,
    doneAt: r.doneAt?.toISOString() ?? null,
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
    refusedAt: r.refusedAt?.toISOString() ?? null,
    partnerContact: { phone: p.phone, whatsapp: p.whatsapp, email: p.email, preferredChannel: p.preferredChannel, active: p.active },
    send: { subject, text, whatsapp: partnerWhatsappLink(p.whatsapp, text), mailto: partnerMailtoLink(p.email, subject, text), tel: p.phone ? `tel:${p.phone.replace(/[^\d+]/g, "")}` : null },
    can: {
      moves: allowedMoves(r.status).filter((s) => s !== "SENT_TO_PARTNER" && checkMove(r, s).ok),
      send: sendable,
      editPrice: priceEditable(r.status),
      recordPayment: paymentRecordable(r.status) && !r.paidAt,
      cancelPayment: !!r.paidAt,
    },
  };
}

interface Locked {
  id: string;
  status: ServiceRequestStatus;
  saleTotalCents: number | null;
  partnerTotalCents: number | null;
  marginCents: number | null;
  paidAt: Date | null;
  paymentMethod: ServicePaymentMethod | null;
  sentAt: Date | null;
  internalNote: string;
}

async function lockRequest(tx: Prisma.TransactionClient, actor: Authorized, id: string): Promise<Locked> {
  const rows = await tx.$queryRaw<Locked[]>`
    SELECT "id", "status", "saleTotalCents", "partnerTotalCents", "marginCents", "paidAt", "paymentMethod", "sentAt", "internalNote"
    FROM "service_requests" WHERE "id" = ${id} AND "organizationId" = ${actor.organizationId} FOR UPDATE`;
  if (!rows[0]) throw requestNotFound();
  return rows[0];
}

const audit = (tx: Prisma.TransactionClient, actor: Authorized, id: string, action: Parameters<typeof recordAudit>[1]["action"], details: Prisma.InputJsonObject) =>
  recordAudit(tx, { organizationId: actor.organizationId, actorId: actor.user.id, action, targetType: "service_request", targetId: id, details });

/**
 * « Envoyer au partenaire »: hands the prefilled message to lib/notifications (delivered only once a provider is
 * plugged in), then records the request as sent (or sent again) by `via`. The associé sends it themselves from the
 * wa.me / mailto: link meanwhile; `delivered` says whether a provider did.
 */
export async function markSent(actor: Authorized, id: string, via: PartnerChannel): Promise<{ delivered: boolean }> {
  const detail = await getRequest(actor, id);
  if (!detail) throw requestNotFound();
  if (!detail.can.send) throw new AppError(409, "REQUEST_STATUS", `Cette demande est ${REQUEST_STATUS_LABEL[detail.status].toLowerCase()} : elle n'est plus à transmettre.`);
  const c = detail.partnerContact;
  const address = { WHATSAPP: c.whatsapp, EMAIL: c.email, PHONE: c.phone }[via];
  if (!address) throw new AppError(422, "NO_CONTACT", "Ce partenaire n'a pas de contact pour ce canal.");
  const result =
    via === "PHONE"
      ? { delivered: false }
      : await notifier().send({
          kind: "service_request.partner",
          to: { name: detail.partner.name, email: via === "EMAIL" ? c.email : null, phone: via === "WHATSAPP" ? c.whatsapp : null },
          subject: detail.send.subject,
          text: detail.send.text,
          channels: [via === "EMAIL" ? "email" : "whatsapp"],
        });
  await db.$transaction(async (tx) => {
    const r = await lockRequest(tx, actor, id);
    const check = checkMove(r, "SENT_TO_PARTNER");
    if (!check.ok) throw new AppError(409, "REQUEST_STATUS", "Cette demande n'est plus à transmettre.");
    await tx.serviceRequest.update({ where: { id }, data: { status: "SENT_TO_PARTNER", sentAt: new Date(), sentVia: via } });
    await audit(tx, actor, id, "service_request.sent", { via, delivered: result.delivered, again: r.status === "SENT_TO_PARTNER" });
  });
  return { delivered: result.delivered };
}

const MOVE_REFUSAL = {
  NOT_ALLOWED: "Cette demande ne peut pas passer à ce statut.",
  NO_PRICE: "Fixez d'abord le prix final (devis) avant de confirmer.",
  PAID: "Cette demande est payée : annulez d'abord l'enregistrement du paiement (remboursement).",
} as const;

/** Confirmed, done, cancelled or refused (sending has its own action, markSent). */
export async function setRequestStatus(actor: Authorized, id: string, to: Exclude<ServiceRequestStatus, "NEW" | "SENT_TO_PARTNER">): Promise<void> {
  requireManager(actor);
  await db.$transaction(async (tx) => {
    const r = await lockRequest(tx, actor, id);
    const check = checkMove(r, to);
    if (!check.ok) throw new AppError(409, "REQUEST_STATUS", MOVE_REFUSAL[check.reason]);
    await tx.serviceRequest.update({ where: { id }, data: { status: to, ...statusTimestamps(to, new Date()) } });
    await audit(tx, actor, id, "service_request.status_changed", { from: r.status, to });
  });
}

/** The final price (a quote, a price agreed with the guest), until the request is confirmed. */
export async function setFinalPrice(actor: Authorized, id: string, input: FinalPriceInput): Promise<void> {
  requireManager(actor);
  const totals = marginOf(input.saleTotalCents, input.partnerTotalCents);
  await db.$transaction(async (tx) => {
    const r = await lockRequest(tx, actor, id);
    if (!priceEditable(r.status)) throw new AppError(409, "REQUEST_STATUS", "Le prix ne se change plus une fois la demande confirmée.");
    if (r.saleTotalCents === totals.saleTotalCents && r.partnerTotalCents === totals.partnerTotalCents) return;
    await tx.serviceRequest.update({ where: { id }, data: { ...totals, priceAdjusted: true } });
    await audit(tx, actor, id, "service_request.price_set", {
      from: { saleTotalCents: r.saleTotalCents, partnerTotalCents: r.partnerTotalCents, marginCents: r.marginCents },
      to: { ...totals },
    });
  });
}

/** Records that the guest paid (cash, card on the spot, transfer…), once, on a confirmed or done request. */
export async function recordPayment(actor: Authorized, id: string, method: ServicePaymentMethod): Promise<void> {
  requireManager(actor);
  await db.$transaction(async (tx) => {
    const r = await lockRequest(tx, actor, id);
    if (r.paidAt) throw new AppError(409, "ALREADY_PAID", "Le paiement de cette demande est déjà enregistré.");
    if (!paymentRecordable(r.status) || r.saleTotalCents === null) throw new AppError(409, "REQUEST_STATUS", "Le paiement s'enregistre sur une demande confirmée ou réalisée.");
    await tx.serviceRequest.update({ where: { id }, data: { paymentMethod: method, paidAt: new Date(), paidById: actor.user.id } });
    await audit(tx, actor, id, "service_request.payment_recorded", { method, amountCents: r.saleTotalCents });
  });
}

/** Takes back a payment recorded by mistake (or refunded). */
export async function cancelPayment(actor: Authorized, id: string): Promise<void> {
  requireManager(actor);
  await db.$transaction(async (tx) => {
    const r = await lockRequest(tx, actor, id);
    if (!r.paidAt) throw new AppError(409, "NOT_PAID", "Aucun paiement n'est enregistré sur cette demande.");
    await tx.serviceRequest.update({ where: { id }, data: { paymentMethod: null, paidAt: null, paidById: null } });
    await audit(tx, actor, id, "service_request.payment_cancelled", { method: r.paymentMethod, amountCents: r.saleTotalCents });
  });
}

export async function setInternalNote(actor: Authorized, id: string, note: string): Promise<void> {
  requireManager(actor);
  await db.$transaction(async (tx) => {
    const r = await lockRequest(tx, actor, id);
    if (r.internalNote === note) return;
    await tx.serviceRequest.update({ where: { id }, data: { internalNote: note } });
    await audit(tx, actor, id, "service_request.note_updated", { length: note.length });
  });
}

export interface ConciergeStats {
  /** Requests not handled yet (new). */
  newRequests: number;
  /** Σ margins of the month's confirmed and done requests, by service date (Marrakech), in centimes. */
  monthMarginCents: number;
  monthRequests: number;
  /** First day of the month (yyyy-MM-dd). */
  month: string;
}

/** Dashboard figures of the conciergerie (associés: amounts). */
export async function conciergeStats(organizationId: string, today = todayInTimeZone(MARRAKECH_TIMEZONE)): Promise<ConciergeStats> {
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
  const [newRequests, month] = await Promise.all([
    db.serviceRequest.count({ where: { organizationId, status: "NEW" } }),
    db.serviceRequest.aggregate({
      where: { organizationId, status: { in: ["CONFIRMED", "DONE"] }, serviceDate: { gte: start, lt: end } },
      _sum: { marginCents: true },
      _count: { _all: true },
    }),
  ]);
  return { newRequests, monthMarginCents: month._sum.marginCents ?? 0, monthRequests: month._count._all, month: iso(start) };
}
