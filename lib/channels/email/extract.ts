import type { PlatformSource } from "../../admin/booking-sources";
import { domainOf, parseMessage, type ParsedMessage } from "./mime";
import { fold, parseAmount, parseDate, parseGuests, valueAfter } from "./text";
import type { AmountKind, EmailKind, ExtractedAmount, ParsedBookingEmail } from "./types";

/**
 * Reads a platform's booking e-mail (Lot 7b): which platform, confirmation / modification / cancellation, the
 * reservation code, guest name, nights, guests, amount and the platform's name of the home. One label-driven reader
 * for every platform, with what differs per platform (sender domains, code format, which amount is the payout) in
 * PLATFORM_RULES; French, English and Spanish labels. The platforms change their e-mails without notice: a message
 * whose code or dates can't be read goes to the manual queue rather than being guessed (lib/server/channels/email/).
 *
 * Amount: the payout when the e-mail gives it (Airbnb « Vous gagnez / You earn », Agoda « net rate »), else the
 * guest's total (Booking.com, Trip.com) — always with its kind, PAYOUT or GUEST_TOTAL, and its currency.
 *
 * Forwarded messages: Gmail / Outlook / Apple Mail inline forwards (« Fwd: », « TR: », « RV: »; the original sender
 * in the « De : / From: » lines of the body) and messages attached as message/rfc822 (the attached one is read).
 */

interface AmountRule {
  labels: readonly string[];
  kind: AmountKind;
}

interface PlatformRules {
  source: PlatformSource;
  /** Sender domains (or their parent domains). */
  domains: RegExp;
  /** The platform named in the text (a forward without its headers). */
  mention: RegExp;
  code: (subject: string, text: string) => string | null;
  /** By priority: the first label found with an amount wins. */
  amounts: readonly AmountRule[];
  listingId: (text: string) => string | null;
}

const CHECKIN_LABELS = ["Date d'arrivée", "Arrivée", "Check-in date", "Check-in", "Check in", "Checkin", "Arrival date", "Arrival", "Fecha de llegada", "Fecha de entrada", "Llegada", "Entrada"];
const CHECKOUT_LABELS = ["Date de départ", "Départ", "Check-out date", "Check-out", "Checkout", "Check out", "Departure date", "Departure", "Fecha de salida", "Salida"];
const GUEST_NAME_LABELS = ["Nom du client", "Nom du voyageur", "Voyageur principal", "Voyageur", "Client", "Réservé par", "Guest name", "Lead guest", "Main guest", "Customer name", "Guest", "Booked by", "Booker", "Nombre del cliente", "Nombre del huésped", "Huésped principal", "Huésped", "Cliente"];
const GUESTS_LABELS = ["Nombre de voyageurs", "Nombre de personnes", "Voyageurs", "Personnes", "Occupants", "Number of guests", "Guests", "Occupancy", "Número de huéspedes", "Número de personas", "Huéspedes", "Personas", "Adultes", "Adults", "Adultos"];
const LISTING_NAME_LABELS = ["Établissement", "Etablissement", "Hébergement", "Logement", "Annonce", "Property name", "Property", "Listing", "Accommodation", "Hotel name", "Hôtel", "Hotel", "Alojamiento", "Propiedad", "Anuncio"];
const LISTING_ID_LABELS = ["Identifiant de l'établissement", "ID de l'établissement", "ID de l'annonce", "Property ID", "Listing ID", "Hotel ID", "ID del alojamiento", "ID de la propiedad"];

function codeAfter(text: string, labels: readonly string[], re: RegExp): string | null {
  const v = valueAfter(text, labels, 1);
  const m = v ? re.exec(v) : null;
  return m?.[1] ?? null;
}

/** The platform's id of the home: after an id label, else « (ID 9900001) » after its name. */
function listingIdFromLabels(text: string): string | null {
  const v = valueAfter(text, LISTING_ID_LABELS, 1);
  return (v ? /([A-Za-z0-9-]{3,40})/.exec(v)?.[1] : null) ?? /\(\s*ID[:\s]*(\d{4,12})\s*\)/i.exec(text)?.[1] ?? null;
}

const BOOKING_CODE_LABELS = ["Numéro de réservation", "N° de réservation", "No de réservation", "Booking number", "Reservation number", "Confirmation number", "Número de reserva", "Número de reservación", "Booking ID"];

export const PLATFORM_RULES: readonly PlatformRules[] = [
  {
    source: "AIRBNB",
    domains: /(^|\.)airbnb\.[a-z.]{2,8}$/,
    mention: /\bairbnb\b/i,
    code: (subject, text) => /\b(HM[A-Z0-9]{8})\b/.exec(subject)?.[1] ?? /\b(HM[A-Z0-9]{8})\b/.exec(text)?.[1] ?? null,
    amounts: [
      { labels: ["Vous gagnez", "Votre versement", "Versement", "You earn", "Your payout", "Host payout", "Payout", "Ganas", "Tu pago", "Tus ganancias"], kind: "PAYOUT" },
      { labels: ["Le voyageur a payé", "Total payé par le voyageur", "Guest paid", "Total paid", "El huésped pagó", "Total"], kind: "GUEST_TOTAL" },
    ],
    listingId: (text) => /airbnb\.[a-z.]{2,8}\/(?:rooms|h|manage-your-space)\/(\d{4,20})/i.exec(text)?.[1] ?? listingIdFromLabels(text),
  },
  {
    source: "BOOKING",
    domains: /(^|\.)booking\.com$/,
    mention: /\bbooking\.com\b/i,
    code: (subject, text) => codeAfter(text, BOOKING_CODE_LABELS, /\b(\d{9,12})\b/) ?? /\((\d{9,12})\b/.exec(subject)?.[1] ?? /(?:r[ée]servation|booking|reserva)\D{0,25}\b(\d{10})\b/i.exec(text)?.[1] ?? null,
    amounts: [{ labels: ["Montant total", "Prix total", "Total price", "Total amount", "Precio total", "Importe total", "Total"], kind: "GUEST_TOTAL" }],
    listingId: (text) => listingIdFromLabels(text),
  },
  {
    source: "AGODA",
    domains: /(^|\.)agoda(-emails)?\.(com|net)$/,
    mention: /\bagoda\b/i,
    code: (subject, text) =>
      codeAfter(text, ["Booking ID", "Numéro de réservation", "ID de réservation", "ID de reserva", "Número de reserva", "Booking number"], /\b(\d{8,12})\b/) ??
      /booking\s*id[:#\s]*(\d{8,12})/i.exec(subject)?.[1] ??
      /(?:r[ée]servation|reserva)\D{0,20}(\d{8,12})/i.exec(subject)?.[1] ??
      null,
    amounts: [
      { labels: ["Net rate to property", "Net rate", "Net amount", "Montant net", "Tarif net", "Tarifa neta", "Importe neto"], kind: "PAYOUT" },
      { labels: ["Montant total", "Total price", "Total amount", "Importe total", "Total"], kind: "GUEST_TOTAL" },
    ],
    listingId: (text) => listingIdFromLabels(text) ?? /property\s*id[:\s]*(\d{3,12})/i.exec(text)?.[1] ?? null,
  },
  {
    source: "TRIPCOM",
    domains: /(^|\.)(trip|ctrip)\.com$/,
    mention: /\btrip\.com\b/i,
    code: (subject, text) =>
      codeAfter(text, ["Order No.", "Order number", "Booking No.", "Numéro de commande", "N° de commande", "Número de pedido", "N.º de pedido", "Reservation number", "Booking number"], /\b(\d{10,19})\b/) ??
      /(?:order|commande|pedido)\s*(?:no\.?|n°|number|n\.º)?[:#\s]*(\d{10,19})/i.exec(subject)?.[1] ??
      null,
    amounts: [
      { labels: ["Payout", "Settlement amount", "Montant versé", "Montant à percevoir", "Importe a liquidar"], kind: "PAYOUT" },
      { labels: ["Total amount", "Montant total", "Importe total", "Order amount", "Total"], kind: "GUEST_TOTAL" },
    ],
    listingId: (text) => listingIdFromLabels(text),
  },
];

/** The platform of a sender's domain (subdomains included: em.airbnb.com, mail.booking.com). */
export function platformOfDomain(domain: string | null): PlatformSource | null {
  if (!domain) return null;
  return PLATFORM_RULES.find((r) => r.domains.test(domain))?.source ?? null;
}

const PREFIX_RE = /^(?:\s*(?:fwd?|tr|fw|re|rv|wg|enc|réf|ref)\s*:\s*)+/i;

export function stripPrefixes(subject: string): string {
  return subject.replace(PREFIX_RE, "").trim();
}

const FORWARD_MARK_RE = /(-{3,}\s*(?:forwarded message|message transféré|mensaje reenviado|original message|message d'origine|mensaje original)\s*-{3,}|^(?:de|from|desde)\s*:\s*.+@.+$)/im;
const FORWARD_FROM_RE = /^(?:de|from|desde|von|da)\s*:\s*.*?([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/gim;
const FORWARD_SUBJECT_RE = /^(?:subject|objet|asunto|sujet)\s*:\s*(.+)$/im;

function kindOf(subject: string, text: string): EmailKind {
  const s = fold(subject);
  if (/annul|cancel|anulad/.test(s)) return "CANCELLATION";
  if (/modifi|chang|alteration|mise a jour|updated|cambi|actualiz/.test(s)) return "MODIFICATION";
  if (/message|question|inquiry|demande d'information|avis|review|commentaire|resena|payout sent|versement (envoye|effectue)|pago enviado/.test(s)) return "UNKNOWN";
  if (/confirm|nouvelle reservation|new (booking|reservation)|nueva reserv|reservation|reserva|booking|arrive|llega/.test(s)) return "CONFIRMATION";
  // Subject says nothing: the start of the body.
  const b = fold(text.slice(0, 600));
  if (/reservation (a ete )?annulee|reservation (has been )?cancel+ed|booking (has been )?cancel+ed|reserva (ha sido )?cancelada|cancellation confirmed/.test(b)) return "CANCELLATION";
  if (/reservation (a ete )?modifiee|reservation (has been )?(changed|modified)|booking (has been )?(changed|modified)|reserva (ha sido )?modificada/.test(b)) return "MODIFICATION";
  if (/reservation confirmee|nouvelle reservation|reservation confirmed|new (booking|reservation)|reserva confirmada|nueva reserva/.test(b)) return "CONFIRMATION";
  return "UNKNOWN";
}

function cleanName(v: string | null): string | null {
  if (!v) return null;
  // « DUPONT/TEST » (surname/given names, Trip.com and some Agoda e-mails) → « Test Dupont ».
  const slash = /^\s*([A-Z][A-Z' -]*)\/([A-Z][A-Z' -]*)\s*$/.exec(v);
  if (slash) v = `${slash[2]} ${slash[1]}`.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase());
  const s = v.replace(/\s*[(|].*$/, "").replace(/[.,;:!]+$/, "").trim();
  if (s.length < 2 || s.length > 80 || /@|https?:|\d{3,}/.test(s) || !/[A-Za-zÀ-ÿ]/.test(s)) return null;
  return s;
}

function guestNameOf(subject: string, text: string): string | null {
  const fromSubject = /[-–:]\s*([^-–:]+?)\s+(?:arrive|arrives|arrivera|llega|llegará)\b/i.exec(subject)?.[1];
  return cleanName(fromSubject ?? null) ?? cleanName(valueAfter(text, GUEST_NAME_LABELS, 1));
}

function amountOf(rules: readonly AmountRule[], text: string): ExtractedAmount | null {
  for (const r of rules) {
    for (const label of r.labels) {
      const v = valueAfter(text, [label], 2, (x) => !!parseAmount(x));
      const money = v ? parseAmount(v) : null;
      if (money) return { ...money, kind: r.kind };
    }
  }
  return null;
}

function listingNameOf(text: string): string | null {
  const v = valueAfter(text, LISTING_NAME_LABELS, 1);
  if (!v) return null;
  const s = v.replace(/\(\s*ID[^)]*\)/i, "").replace(/https?:\/\/\S+/g, "").trim();
  return s.length >= 2 && s.length <= 200 ? s : null;
}

const BOOKING_WORDS = /r[ée]servation|reservation|booking|reserva|check-?in|arriv[ée]e|llegada|s[ée]jour|stay|estancia/i;

/** Every sender domain seen: the message's, the forwarded messages' (« De : … <x@airbnb.com> » lines). */
function senderDomains(msg: ParsedMessage): string[] {
  const out = [domainOf(msg.from?.address)];
  for (const m of msg.text.matchAll(FORWARD_FROM_RE)) out.push(domainOf(m[1]));
  return out.filter((d): d is string => !!d);
}

/** Reads a raw message. `received`: when it arrived (default: its Date header, else now), for dates without a year. */
export function parseBookingEmail(raw: Uint8Array | string, received?: Date): ParsedBookingEmail {
  const outer = parseMessage(raw);
  const authResults = (outer.headers.get("authentication-results") ?? []).join(" ");
  const authFailed = /\b(dkim|dmarc)=fail\b/i.test(authResults);
  // Forwarded as an attachment: read the attached platform message.
  const attached = outer.attached.find((m) => platformOfDomain(domainOf(m.from?.address))) ?? null;
  const msg = attached ?? outer;
  const text = [msg.text, msg.htmlText && msg.htmlText !== msg.text ? msg.htmlText : ""].filter(Boolean).join("\n\n");
  const forwarded = !!attached || PREFIX_RE.test(outer.subject) || FORWARD_MARK_RE.test(msg.text.slice(0, 4000));
  const domains = senderDomains(msg);
  let platform: PlatformSource | null = null;
  let senderDomain = domains[0] ?? null;
  for (const d of domains) {
    const p = platformOfDomain(d);
    if (p) {
      platform = p;
      senderDomain = d;
      break;
    }
  }
  const innerSubject = forwarded && !attached ? FORWARD_SUBJECT_RE.exec(msg.text)?.[1]?.trim() : undefined;
  const subject = stripPrefixes(innerSubject && innerSubject.length > 3 ? innerSubject : msg.subject || outer.subject);
  // A forward stripped of its headers: the platform named in the text with its code format.
  if (!platform) {
    for (const r of PLATFORM_RULES) {
      if (r.mention.test(`${subject}\n${text}`) && r.code(subject, text) && (r.source === "AIRBNB" || forwarded)) {
        platform = r.source;
        break;
      }
    }
  }
  const rules = PLATFORM_RULES.find((r) => r.source === platform) ?? null;
  const ref = received ?? msg.date ?? outer.date ?? new Date();
  const kind = kindOf(subject, text);
  const hasDate = (v: string) => !!parseDate(v, ref);
  const checkInText = valueAfter(text, CHECKIN_LABELS, 2, hasDate);
  const checkOutText = valueAfter(text, CHECKOUT_LABELS, 2, hasDate);
  const checkIn = checkInText ? parseDate(checkInText, ref) : null;
  let checkOut = checkOutText ? parseDate(checkOutText, ref) : null;
  // A departure without a year written before an arrival in December: next year.
  if (checkIn && checkOut && checkOut <= checkIn && checkOutText && !/\d{4}/.test(checkOutText)) {
    const next = parseDate(checkOutText, new Date(`${checkIn}T00:00:00Z`));
    if (next && next > checkIn) checkOut = next;
  }
  const guestsText = valueAfter(text, GUESTS_LABELS, 1);
  const g = guestsText ? (/^\s*\d{1,2}\s*$/.test(guestsText) ? { adults: Number(guestsText), children: null, infants: null, total: Number(guestsText) } : parseGuests(guestsText)) : parseGuests("");
  const code = rules ? rules.code(subject, text) : null;
  const missing: string[] = [];
  if (!code) missing.push("code");
  if (kind !== "CANCELLATION") {
    if (!checkIn) missing.push("checkIn");
    if (!checkOut || (checkIn && checkOut <= checkIn)) missing.push("checkOut");
  }
  return {
    platform,
    kind,
    code,
    guestName: rules ? guestNameOf(subject, text) : null,
    checkIn,
    checkOut: checkOut && checkIn && checkOut <= checkIn ? null : checkOut,
    adults: g.adults,
    children: g.children,
    infants: g.infants,
    amount: rules ? amountOf(rules.amounts, text) : null,
    listing: { platformId: rules ? rules.listingId(text) : null, name: rules ? listingNameOf(text) : null },
    forwarded,
    bookingLike: BOOKING_WORDS.test(subject) || (BOOKING_WORDS.test(text) && !!(checkIn || checkOut)),
    authFailed,
    missing,
    subject: subject.slice(0, 300),
    fromAddress: outer.from?.address ?? null,
    senderDomain,
    messageId: outer.messageId,
    date: (outer.date ?? msg.date)?.toISOString() ?? null,
    excerpt: text.slice(0, 4000),
  };
}
