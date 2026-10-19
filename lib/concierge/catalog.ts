import type { PartnerChannel, Role, ServiceCategory, ServicePaymentMethod, ServicePricingModel, ServiceRequestStatus } from "@/lib/generated/prisma/enums";

/**
 * Conciergerie (Lot 4b): the catalogue's vocabulary and rules, shared by the back-office, the guest guide, the seed
 * and the tests. Pure. French labels are the team's; the guests' labels are in lib/i18n/messages.
 */

export const SERVICE_CATEGORY_LABEL: Record<ServiceCategory, string> = {
  CAR: "Voiture",
  ACTIVITY: "Activité",
  TRANSFER: "Transfert",
  CHEF: "Chef à domicile",
  HAMMAM: "Hammam",
  CLEANING: "Ménage",
  GROCERIES: "Courses",
  OTHER: "Autre",
};
export const SERVICE_CATEGORIES = Object.keys(SERVICE_CATEGORY_LABEL) as [ServiceCategory, ...ServiceCategory[]];

/** French URL values of the category filter (?categorie=hammam). */
export const SERVICE_CATEGORY_PARAM: Record<string, ServiceCategory> = {
  voiture: "CAR",
  activite: "ACTIVITY",
  transfert: "TRANSFER",
  chef: "CHEF",
  hammam: "HAMMAM",
  menage: "CLEANING",
  courses: "GROCERIES",
  autre: "OTHER",
};

export const PRICING_MODEL_LABEL: Record<ServicePricingModel, string> = {
  PER_UNIT: "À l'unité",
  PER_PERSON: "Par personne",
  PER_DAY: "Par jour",
  PER_TRIP: "Par trajet",
  ON_QUOTE: "Sur devis",
};
export const PRICING_MODELS = Object.keys(PRICING_MODEL_LABEL) as [ServicePricingModel, ...ServicePricingModel[]];

/** What the quantity counts, per pricing model (back-office). */
export const QUANTITY_LABEL: Record<ServicePricingModel, string> = {
  PER_UNIT: "Quantité",
  PER_PERSON: "Personnes",
  PER_DAY: "Jours",
  PER_TRIP: "Trajets",
  ON_QUOTE: "Quantité",
};

export const PARTNER_CHANNEL_LABEL: Record<PartnerChannel, string> = { WHATSAPP: "WhatsApp", EMAIL: "E-mail", PHONE: "Téléphone" };
export const PARTNER_CHANNELS = Object.keys(PARTNER_CHANNEL_LABEL) as [PartnerChannel, ...PartnerChannel[]];

export const REQUEST_STATUS_LABEL: Record<ServiceRequestStatus, string> = {
  NEW: "Nouvelle",
  SENT_TO_PARTNER: "Transmise au partenaire",
  CONFIRMED: "Confirmée",
  DONE: "Réalisée",
  CANCELLED: "Annulée",
  REFUSED: "Refusée",
};
export const REQUEST_STATUSES = Object.keys(REQUEST_STATUS_LABEL) as [ServiceRequestStatus, ...ServiceRequestStatus[]];

/** French URL values of the requests' status filter. */
export const REQUEST_STATUS_PARAM: Record<string, ServiceRequestStatus> = {
  nouvelles: "NEW",
  transmises: "SENT_TO_PARTNER",
  confirmees: "CONFIRMED",
  realisees: "DONE",
  annulees: "CANCELLED",
  refusees: "REFUSED",
};

/** Requests still to follow (the default filter of « Demandes »). */
export const OPEN_REQUEST_STATUSES: readonly ServiceRequestStatus[] = ["NEW", "SENT_TO_PARTNER", "CONFIRMED"];

export const PAYMENT_METHOD_LABEL: Record<ServicePaymentMethod, string> = {
  CASH: "Espèces",
  CARD: "Carte bancaire (sur place)",
  BANK_TRANSFER: "Virement",
  OTHER: "Autre",
};
export const PAYMENT_METHODS = Object.keys(PAYMENT_METHOD_LABEL) as [ServicePaymentMethod, ...ServicePaymentMethod[]];

/**
 * The moves a request can make. Sending (NEW → SENT_TO_PARTNER) is its own action (« Envoyer au partenaire »), and
 * may be repeated while the partner hasn't answered (SENT_TO_PARTNER → SENT_TO_PARTNER: sent again). DONE, CANCELLED
 * and REFUSED are final. A paid request can't be cancelled until its payment is taken back (refund).
 */
const MOVES: Record<ServiceRequestStatus, readonly ServiceRequestStatus[]> = {
  NEW: ["SENT_TO_PARTNER", "CANCELLED", "REFUSED"],
  SENT_TO_PARTNER: ["SENT_TO_PARTNER", "CONFIRMED", "CANCELLED", "REFUSED"],
  CONFIRMED: ["DONE", "CANCELLED"],
  DONE: [],
  CANCELLED: [],
  REFUSED: [],
};

export function allowedMoves(from: ServiceRequestStatus): readonly ServiceRequestStatus[] {
  return MOVES[from];
}

export type MoveRefusal = "NOT_ALLOWED" | "NO_PRICE" | "PAID";

/** Whether a request may go from `from` to `to`; confirming needs a price (quotes), cancelling an unpaid request. */
export function checkMove(req: { status: ServiceRequestStatus; saleTotalCents: number | null; paidAt: Date | string | null }, to: ServiceRequestStatus): { ok: true } | { ok: false; reason: MoveRefusal } {
  if (!MOVES[req.status].includes(to)) return { ok: false, reason: "NOT_ALLOWED" };
  if (to === "CONFIRMED" && req.saleTotalCents === null) return { ok: false, reason: "NO_PRICE" };
  if (to === "CANCELLED" && req.paidAt) return { ok: false, reason: "PAID" };
  return { ok: true };
}

/** The final price may be set until the request is confirmed (then it is what the guest and the partner agreed). */
export function priceEditable(status: ServiceRequestStatus): boolean {
  return status === "NEW" || status === "SENT_TO_PARTNER";
}

/** A payment is recorded on a confirmed or done request. */
export function paymentRecordable(status: ServiceRequestStatus): boolean {
  return status === "CONFIRMED" || status === "DONE";
}

/** The timestamp columns a status sets, for a move to `to` at `now` (the earlier ones are kept). */
export function statusTimestamps(to: ServiceRequestStatus, now: Date): Partial<Record<"sentAt" | "confirmedAt" | "doneAt" | "cancelledAt" | "refusedAt", Date>> {
  switch (to) {
    case "SENT_TO_PARTNER":
      return { sentAt: now };
    case "CONFIRMED":
      return { confirmedAt: now };
    case "DONE":
      return { doneAt: now };
    case "CANCELLED":
      return { cancelledAt: now };
    case "REFUSED":
      return { refusedAt: now };
    default:
      return {};
  }
}

/** Partner prices, margins and partners' contacts are for associés; agents read the catalogue with sale prices only. */
export function canSeePartnerPrices(role: Role): boolean {
  return role === "ADMIN";
}

/** A short reference for a request, shown to the guest, the team and the partner (the id's last 6 characters). */
export function requestReference(id: string): string {
  return id.slice(-6).toUpperCase();
}
