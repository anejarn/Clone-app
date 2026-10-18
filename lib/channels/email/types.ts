import type { PlatformSource } from "../../admin/booking-sources";

/**
 * Booking e-mails of the platforms (Lot 7b): what Sigma reads from them, and where they come from.
 *
 * The receiving service (an inbound e-mail provider that posts each message to a webhook, or a mailbox read over
 * IMAP) is NOT chosen yet: it is the associés' choice, with its loi 09-08 transfer question. Everything else is
 * built behind InboundEmailSource:
 * - a push service (most providers: Postmark, Mailgun, SendGrid, Cloudflare Email Workers, AWS SES + Lambda…) posts
 *   the raw message to POST /api/inbound-email/<token> (the organization's secret URL, Synchronisation → E-mails):
 *   nothing to implement here, the route takes message/rfc822 or JSON { raw };
 * - a pull service (IMAP mailbox, a provider's API) implements InboundEmailSource.fetchNew and is returned by
 *   inboundEmailSources() (lib/channels/email/sources.ts): the background worker reads it every tick.
 * Until then, « Déposer un e-mail » (paste or upload a .eml) feeds the same processing by hand.
 */

export type EmailKind = "CONFIRMATION" | "MODIFICATION" | "CANCELLATION" | "UNKNOWN";

/** PAYOUT = what the platform pays Sigma (Airbnb « Vous gagnez », Agoda's net rate); GUEST_TOTAL = what the guest pays. */
export type AmountKind = "PAYOUT" | "GUEST_TOTAL";

export interface ExtractedAmount {
  cents: number;
  currency: string;
  kind: AmountKind;
}

export interface ParsedBookingEmail {
  /** The platform, from the sender (or the forwarded message's sender) and its codes. Null: not recognized. */
  platform: PlatformSource | null;
  kind: EmailKind;
  /** The platform's reservation code (Airbnb HM…, Booking.com number, Agoda booking ID, Trip.com order number). */
  code: string | null;
  guestName: string | null;
  /** Nights, yyyy-MM-dd; checkOut is the departure day. */
  checkIn: string | null;
  checkOut: string | null;
  adults: number | null;
  children: number | null;
  infants: number | null;
  amount: ExtractedAmount | null;
  /** How the platform names the home (its listing / property id and title), for matching with ChannelFeed. */
  listing: { platformId: string | null; name: string | null };
  /** Forwarded by a person (Gmail, Outlook « Fwd: », « TR: », attached message). */
  forwarded: boolean;
  /** Reads like a reservation e-mail (keywords), even from an unknown sender. */
  bookingLike: boolean;
  /** The receiving service reported a failed DKIM / DMARC / SPF check: never applied automatically. */
  authFailed: boolean;
  /** Fields a confirmation needs and that weren't found: code, checkIn, checkOut. */
  missing: string[];
  subject: string;
  fromAddress: string | null;
  /** The domain of the sender, or of the forwarded message's original sender when forwarded. */
  senderDomain: string | null;
  messageId: string | null;
  date: string | null;
  /** The beginning of the text, for the manual queue. */
  excerpt: string;
}

/** A message as a source hands it over. */
export interface RawInboundEmail {
  raw: Uint8Array;
  receivedAt?: Date;
}

/**
 * Where booking e-mails come from (the receiving service, to be chosen). A pull source returns what arrived since its
 * last call for an organization; the worker passes each message to the same processing as the webhook.
 */
export interface InboundEmailSource {
  readonly id: string;
  /** The organizations this source receives for. */
  organizations(): Promise<string[]>;
  fetchNew(organizationId: string): Promise<RawInboundEmail[]>;
}
