import { whatsappNumber } from "@/lib/admin/users";
import type { ServicePricingModel } from "@/lib/generated/prisma/enums";
import { formatDate, formatMad } from "@/lib/format";
import { formatTimeOfDay } from "@/lib/operations/schedule";
import { QUANTITY_LABEL } from "./catalog";

/**
 * The message sent to a partner for a request (« Envoyer au partenaire »), in French, and its wa.me and mailto: links.
 * Pure. No WhatsApp or e-mail provider is chosen yet (the associés' choice, with its loi 09-08 transfer question): the
 * associé opens the link and sends the prefilled message from their own WhatsApp or mailbox; the same text goes
 * through lib/notifications, which sends nothing until a provider is plugged in.
 *
 * What the partner needs and nothing more: the service, when, how many, options, where, the guest's first name and
 * the phone number the guest gave for this request, their note, and the partner's price. Never Sigma's sale price or
 * margin, the booking's amounts, the guest's e-mail or another guest.
 */

export interface PartnerMessageInput {
  organizationName: string;
  partnerName: string;
  reference: string;
  title: string;
  /** UTC midnight of the local day, and minutes after local midnight. */
  serviceDate: Date;
  startMinutes: number;
  pricingModel: ServicePricingModel;
  quantity: number;
  persons: number;
  /** French labels of the options chosen. */
  options: readonly string[];
  place: { address: string; placeName: string; city: string };
  guestFirstName: string | null;
  contactPhone: string;
  guestNote: string;
  /** What the partner is paid; null while a quote is pending. */
  partnerTotalCents: number | null;
}

export function partnerMessageSubject(i: Pick<PartnerMessageInput, "organizationName" | "reference" | "title" | "serviceDate">): string {
  return `${i.organizationName} — demande ${i.reference} : ${i.title} le ${formatDate(i.serviceDate)}`;
}

export function buildPartnerMessage(i: PartnerMessageInput): string {
  const lines = [
    `Bonjour ${i.partnerName},`,
    "",
    `Nouvelle demande de ${i.organizationName} (réf. ${i.reference}) :`,
    `• Service : ${i.title}`,
    `• Date : ${formatDate(i.serviceDate)} à ${formatTimeOfDay(i.startMinutes)}`,
    `• Personnes : ${i.persons}`,
  ];
  if (i.pricingModel !== "PER_PERSON") lines.push(`• ${QUANTITY_LABEL[i.pricingModel]} : ${i.quantity}`);
  if (i.options.length) lines.push(`• Options : ${i.options.join(", ")}`);
  lines.push(`• Lieu : ${i.place.address}${i.place.address.includes(i.place.placeName) ? "" : `, ${i.place.placeName}`}, ${i.place.city}`);
  lines.push(`• Client : ${i.guestFirstName ?? "voyageur"}, ${i.contactPhone}`);
  if (i.guestNote) lines.push(`• Note du client : ${i.guestNote.replace(/\s+/g, " ")}`);
  lines.push(i.partnerTotalCents === null ? "• Prix : à nous indiquer (devis)" : `• Votre prix : ${formatMad(i.partnerTotalCents)}`);
  lines.push("", "Merci de nous confirmer la disponibilité en répondant à ce message.", i.organizationName);
  return lines.join("\n");
}

/** https://wa.me/<number>?text=… for the partner's WhatsApp number; null without a usable number. */
export function partnerWhatsappLink(whatsapp: string | null | undefined, text: string): string | null {
  const n = whatsappNumber(whatsapp);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
}

/** mailto:<address>?subject=…&body=… (RFC 6068: percent-encoded, CRLF line breaks); null without an address. */
export function partnerMailtoLink(email: string | null | undefined, subject: string, body: string): string | null {
  if (!email || !/^[^\s@?&#]+@[^\s@?&#]+$/.test(email)) return null;
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.replace(/\r?\n/g, "\r\n"))}`;
}
