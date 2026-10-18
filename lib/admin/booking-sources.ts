import type { BookingChannel, BookingSource } from "@/lib/generated/prisma/enums";

/**
 * How booking sources look in the back-office (calendar bars, legend, lists). Text labels name the platforms; no
 * logo or brand colour of theirs is used: the colours are Sigma's own palette, chosen to be told apart from each
 * other and to carry white text at WCAG AA (each ≥ 5.9:1 on white text, see tests/unit/booking-sources.test.ts).
 * Colour is never the only cue: every bar also carries the source's name in its text and accessible label.
 */

export const SOURCES = ["DIRECT", "AIRBNB", "BOOKING", "AGODA", "TRIPCOM", "EXPEDIA", "OTHER", "OWNER"] as const satisfies readonly BookingSource[];

/**
 * Platforms: a booking from one of them has the platform's code (externalRef) and optional amounts. EXPEDIA covers
 * Vrbo (same group); OTHER is any other site that gives an iCal link (Lot 7).
 */
export const PLATFORM_SOURCES = ["AIRBNB", "BOOKING", "AGODA", "TRIPCOM", "EXPEDIA", "OTHER"] as const satisfies readonly BookingSource[];
export type PlatformSource = (typeof PLATFORM_SOURCES)[number];

export function isPlatformSource(s: string): s is PlatformSource {
  return (PLATFORM_SOURCES as readonly string[]).includes(s);
}

export const SOURCE_LABEL: Record<BookingSource, string> = {
  DIRECT: "Directe",
  AIRBNB: "Airbnb",
  BOOKING: "Booking.com",
  AGODA: "Agoda",
  TRIPCOM: "Trip.com",
  EXPEDIA: "Expedia",
  OTHER: "Autre plateforme",
  OWNER: "Blocage propriétaire",
};

/** Short form for narrow calendar bars. */
export const SOURCE_SHORT: Record<BookingSource, string> = {
  DIRECT: "Directe",
  AIRBNB: "Airbnb",
  BOOKING: "Booking",
  AGODA: "Agoda",
  TRIPCOM: "Trip.com",
  EXPEDIA: "Expedia",
  OTHER: "Autre",
  OWNER: "Propriétaire",
};

export interface SourceStyle {
  /** Bar background (CSS colour or gradient). */
  background: string;
  /** Text colour on the bar. */
  color: string;
  /** Border colour (the owner block's hatching needs an edge). */
  border: string;
}

/** Hex colours of the bars, white text on each. */
export const SOURCE_COLOR: Record<Exclude<BookingSource, "OWNER">, string> = {
  DIRECT: "#3550a8", // Sigma Majorelle blue (brand)
  AIRBNB: "#a8325e", // raspberry
  BOOKING: "#0f6e7a", // teal
  AGODA: "#7a1fa2", // violet
  TRIPCOM: "#9a4a0b", // burnt orange
  EXPEDIA: "#3f6b1f", // olive green
  OTHER: "#333333", // charcoal
};

/** Owner blocks: light grey hatching with dark text, so they read as "not a stay" at a glance. */
export const OWNER_BLOCK_STYLE: SourceStyle = {
  background: "repeating-linear-gradient(135deg, #e3e6ea 0 6px, #c9ced6 6px 12px)",
  color: "#222222",
  border: "#5b6472",
};

export function sourceStyle(source: BookingSource): SourceStyle {
  if (source === "OWNER") return OWNER_BLOCK_STYLE;
  const c = SOURCE_COLOR[source];
  return { background: c, color: "#ffffff", border: c };
}

export const CHANNELS = ["PHONE", "WHATSAPP", "EMAIL", "IN_PERSON", "OTHER"] as const satisfies readonly BookingChannel[];

export const CHANNEL_LABEL: Record<BookingChannel, string> = {
  PHONE: "Téléphone",
  WHATSAPP: "WhatsApp",
  EMAIL: "E-mail",
  IN_PERSON: "En personne",
  OTHER: "Autre",
};

/** Status labels. */
export const STATUS_LABEL = { CONFIRMED: "Confirmée", CANCELLED: "Annulée" } as const;
