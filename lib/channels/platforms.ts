import type { PlatformSource } from "../admin/booking-sources";
import type { IcalEvent } from "./ical/parse";

/**
 * The platforms Sigma exchanges calendars with (Lot 7), each mapped to a BookingSource. What a platform's iCal feed
 * looks like is described here, once: how to tell a reservation from a « not available » block, where its own
 * reservation code is, which host names its links come from. Text labels only, never a logo or a brand colour.
 *
 * What the feeds are known to contain (to be checked again with each platform's current export; anonymized samples
 * in tests/fixtures/ical/):
 * - Airbnb: « Reserved » for a reservation (DESCRIPTION has the reservation URL with its HM… code and the last digits
 *   of the guest's phone, which Sigma never stores), « Airbnb (Not available) » for dates blocked on Airbnb;
 * - Booking.com: every event is « CLOSED - Not available », reservations and closed dates alike: imported as
 *   reservations (field tasks are made), unless they are only Sigma's own export coming back (echo);
 * - Agoda, Trip.com, Expedia / Vrbo, others: summaries vary (« Reserved », « Blocked », a reservation number…):
 *   anything that reads as « not available / blocked / closed » is a block, the rest a reservation.
 */

export type EventKind = "reservation" | "block";

export interface EventClass {
  kind: EventKind;
  /**
   * The summary doesn't tell a real reservation from a date closed on the platform, which may be nothing but Sigma's
   * own export coming back: such events are checked against what Sigma exports (lib/channels/busy.ts isEcho).
   */
  ambiguous: boolean;
}

export interface PlatformDescriptor {
  source: PlatformSource;
  /** Name shown in the back-office. */
  label: string;
  /** Host names (or their suffixes) the platform's iCal links come from; a link from elsewhere gets a warning. */
  hosts: readonly string[];
  classify(ev: Pick<IcalEvent, "summary" | "description">): EventClass;
  /** The platform's own reservation code when the feed gives it (matched with a booking typed by hand). */
  reference(ev: Pick<IcalEvent, "summary" | "description" | "uid">): string | null;
  /** Where to find the links on the platform (short; the step-by-step guide comes later). */
  importHint: string;
  exportHint: string;
}

const BLOCK_RE = /not\s*available|unavailable|blocked|closed|indisponible|bloqu|ferm[ée]/i;

function genericClassify(ev: Pick<IcalEvent, "summary">): EventClass {
  return BLOCK_RE.test(ev.summary) ? { kind: "block", ambiguous: true } : { kind: "reservation", ambiguous: false };
}

const AIRBNB_CODE_RE = /\/reservations\/details\/([A-Z0-9]{8,12})\b/;

export const PLATFORMS: readonly PlatformDescriptor[] = [
  {
    source: "AIRBNB",
    label: "Airbnb",
    hosts: ["airbnb.com", "airbnb.fr", "airbnb.es", "airbnb.co.uk", "airbnb.de", "airbnb.it", "airbnb.nl", "airbnb.be"],
    classify(ev) {
      if (/^reserved$/i.test(ev.summary.trim())) return { kind: "reservation", ambiguous: false };
      if (BLOCK_RE.test(ev.summary)) return { kind: "block", ambiguous: true };
      return genericClassify(ev);
    },
    reference(ev) {
      return AIRBNB_CODE_RE.exec(ev.description)?.[1] ?? null;
    },
    importHint: "Annonces → l'annonce → Disponibilités → Associer des calendriers → Exporter le calendrier (lien .ics).",
    exportHint: "Même écran → Importer un calendrier : collez le lien Sigma ci-dessous.",
  },
  {
    source: "BOOKING",
    label: "Booking.com",
    hosts: ["booking.com"],
    classify(ev) {
      // Reservations and closed dates look the same: a reservation (tasks), checked against Sigma's export.
      if (BLOCK_RE.test(ev.summary) || !ev.summary.trim()) return { kind: "reservation", ambiguous: true };
      return genericClassify(ev);
    },
    reference: () => null,
    importHint: "Extranet → Tarifs et disponibilités → Synchroniser les calendriers → Exporter (lien .ics).",
    exportHint: "Même écran → Importer un calendrier : collez le lien Sigma ci-dessous.",
  },
  {
    source: "AGODA",
    label: "Agoda",
    hosts: ["agoda.com", "agoda.net", "ycs.agoda.com"],
    classify: genericClassify,
    reference: () => null,
    importHint: "YCS → Calendrier → Synchronisation iCal → Exporter.",
    exportHint: "Même écran → Importer : collez le lien Sigma ci-dessous.",
  },
  {
    source: "TRIPCOM",
    label: "Trip.com",
    hosts: ["trip.com", "ctrip.com", "tripcdn.com"],
    classify: genericClassify,
    reference: () => null,
    importHint: "Espace partenaire → Calendrier → Synchronisation iCal → Exporter.",
    exportHint: "Même écran → Importer : collez le lien Sigma ci-dessous.",
  },
  {
    source: "EXPEDIA",
    label: "Expedia / Vrbo",
    hosts: ["vrbo.com", "homeaway.com", "expedia.com", "abritel.fr"],
    classify: genericClassify,
    reference: () => null,
    importHint: "Vrbo : Calendrier → Importer et exporter → Exporter le calendrier.",
    exportHint: "Même écran → Importer un calendrier : collez le lien Sigma ci-dessous.",
  },
  {
    source: "OTHER",
    label: "Autre plateforme",
    hosts: [],
    classify: genericClassify,
    reference: () => null,
    importHint: "Le lien iCal (.ics) d'export de la plateforme.",
    exportHint: "Collez le lien Sigma dans l'import de calendrier de la plateforme.",
  },
];

export function platform(source: PlatformSource): PlatformDescriptor {
  const p = PLATFORMS.find((x) => x.source === source);
  if (!p) throw new Error(`Unknown platform ${source}`);
  return p;
}

/** Whether a link's host name is one of the platform's (always true for « Autre plateforme »). */
export function hostMatches(p: PlatformDescriptor, host: string): boolean {
  if (!p.hosts.length) return true;
  const h = host.toLowerCase().replace(/\.$/, "");
  return p.hosts.some((x) => h === x || h.endsWith(`.${x}`));
}
