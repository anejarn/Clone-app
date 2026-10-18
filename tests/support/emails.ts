/**
 * Booking e-mails built for the integration and e2e tests (Lot 7b), in the shape of the anonymized samples of
 * tests/fixtures/email/ but with the dates, codes and Message-IDs a test needs (fictional values only).
 */

export interface TestEmail {
  platform: "AIRBNB" | "BOOKING" | "AGODA" | "UNKNOWN";
  kind: "CONFIRMATION" | "MODIFICATION" | "CANCELLATION";
  code: string;
  /** yyyy-MM-dd. */
  checkIn: string;
  checkOut: string;
  guest?: string;
  adults?: number;
  children?: number;
  /** "4 512,00 MAD", "€ 480.00"… */
  amount?: string;
  listingName?: string;
  listingId?: string;
  messageId?: string;
  /** Extra headers, e.g. Authentication-Results. */
  headers?: string[];
}

const fr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

function qp(s: string): string {
  return [...Buffer.from(s, "utf8")]
    .map((b) => (b === 0x0a ? "\r\n" : b === 0x3d || b > 0x7e || (b < 0x20 && b !== 0x09) ? `=${b.toString(16).toUpperCase().padStart(2, "0")}` : String.fromCharCode(b)))
    .join("");
}

export function buildEmail(e: TestEmail): string {
  const mid = e.messageId ?? `${e.platform.toLowerCase()}-${e.kind.toLowerCase()}-${e.code}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.example`;
  let from: string;
  let subject: string;
  let body: string;
  const guests = e.adults ? `${e.adults} adultes${e.children ? `, ${e.children} enfant${e.children > 1 ? "s" : ""}` : ""}` : "";
  if (e.platform === "AIRBNB") {
    from = "Airbnb <automated@airbnb.com>";
    subject = e.kind === "CANCELLATION" ? `Réservation ${e.code} annulée` : e.kind === "MODIFICATION" ? `Réservation ${e.code} modifiée` : `Réservation confirmée - ${e.guest ?? "Voyageur Test"} arrive bientôt`;
    body = [
      e.kind === "CONFIRMATION" ? `Nouvelle réservation confirmée ! ${e.guest ?? "Voyageur Test"} arrive le ${fr(e.checkIn)}.` : "La réservation ci-dessous a changé.",
      "",
      ...(e.listingName ? [`Logement : ${e.listingName}`] : []),
      ...(e.listingId ? [`https://www.airbnb.fr/rooms/${e.listingId}`] : []),
      `Arrivée : ${fr(e.checkIn)}`,
      `Départ : ${fr(e.checkOut)}`,
      ...(guests ? [`Voyageurs : ${guests}`] : []),
      `Code de confirmation : ${e.code}`,
      ...(e.amount ? [`Vous gagnez : ${e.amount}`] : []),
      "",
    ].join("\n");
  } else if (e.platform === "BOOKING" || e.platform === "AGODA") {
    from = e.platform === "BOOKING" ? "Booking.com <noreply@booking.com>" : "Agoda <no-reply@agoda.com>";
    subject =
      e.kind === "CANCELLATION" ? `Annulation de la réservation (${e.code})` : e.kind === "MODIFICATION" ? `Réservation modifiée (${e.code})` : `Nouvelle réservation ! (${e.code})`;
    body = [
      e.kind === "CANCELLATION" ? "Cette réservation a été annulée." : "Détails de la réservation.",
      "",
      ...(e.listingName ? [`Établissement : ${e.listingName}${e.listingId ? ` (ID ${e.listingId})` : ""}`] : []),
      `Numéro de réservation : ${e.code}`,
      ...(e.guest ? [`Nom du client : ${e.guest}`] : []),
      `Arrivée : ${fr(e.checkIn)}`,
      `Départ : ${fr(e.checkOut)}`,
      ...(guests ? [`Nombre de personnes : ${guests}`] : []),
      ...(e.amount ? [`${e.platform === "AGODA" ? "Montant net" : "Montant total"} : ${e.amount}`] : []),
      "",
    ].join("\n");
  } else {
    from = "Plateforme Exemple <reservations@plateforme-exemple.test>";
    subject = `Nouvelle réservation n° ${e.code}`;
    body = [`Une nouvelle réservation a été effectuée.`, "", `Référence : ${e.code}`, `Arrivée : ${fr(e.checkIn)}`, `Départ : ${fr(e.checkOut)}`, ...(guests ? [`Voyageurs : ${guests}`] : []), ""].join("\n");
  }
  return [
    ...(e.headers ?? []),
    `From: ${from}`,
    "To: reservations@sigma-test.example",
    `Subject: =?utf-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${mid}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    qp(body),
  ].join("\r\n");
}
