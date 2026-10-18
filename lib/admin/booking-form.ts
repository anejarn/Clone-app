import { z } from "zod";
import type { BookingSource } from "@/lib/generated/prisma/enums";
import { centimesToDirhams, dirhamsToCentimes } from "@/lib/money";
import { nightsBetween, priceBreakdown } from "@/lib/pricing";
import { CONTROL_RE, ID_RE } from "@/lib/server/schemas";
import { CHANNELS, PLATFORM_SOURCES } from "./booking-sources";
import { parseDay } from "./calendar";

/**
 * Bookings typed by the team (Réservations → Nouvelle saisie), validated on the server by
 * app/admin/reservations/actions.ts; rules that need the listing or the database (capacity, minimum stay, overlaps,
 * duplicate platform codes) are in lib/server/admin/bookings.ts. Three kinds:
 * - "directe": a guest who booked with Sigma by phone, WhatsApp… (source DIRECT, no account needed);
 * - "plateforme": a platform booking typed by hand (source + platform code; amounts optional);
 * - "blocage": an owner keeping their dates (source OWNER: dates and a reason only).
 * Amounts are typed in dirhams and stored in centimes (lib/money.ts); the computations below are unit-tested.
 */

export const ENTRY_KINDS = ["directe", "plateforme", "blocage"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export const ENTRY_KIND_LABEL: Record<EntryKind, string> = {
  directe: "Réservation directe",
  plateforme: "Réservation plateforme",
  blocage: "Blocage propriétaire",
};

export const ENTRY_LIMITS = {
  /** Longest stay or block the team can type (an owner may keep a whole season). */
  maxNights: 365,
  /** How far ahead a stay can start. */
  windowDays: 730,
  guests: 50,
  infants: 10,
  pets: 10,
  name: 120,
  email: 200,
  phone: 30,
  externalRef: 64,
  note: 2000,
  /** 10 000 000 MAD in centimes: far above any stay, inside a Postgres integer. */
  maxAmountCents: 1_000_000_000,
} as const;

// ---------- Amounts (centimes of MAD) ----------

export interface BookingAmounts {
  nights: number;
  /** Price per night stored on the booking (for a platform booking, the average: informative). */
  nightlyCents: number;
  /** Nights × nightly for a direct booking; total − cleaning for a platform one. */
  stayCents: number;
  cleaningFeeCents: number;
  /** Always 0: Sigma charges no guest service fee (lib/pricing.ts). */
  serviceFeeCents: number;
  /** The amount of the booking. Direct: always the exact sum of the lines above. */
  totalCents: number;
}

/**
 * A direct booking: nightly price × nights + cleaning fee, with the listing's prices unless the team typed others
 * (a negotiated price, cleaning offered). `null` overrides mean "the listing's".
 */
export function directAmounts(
  listing: { priceCents: number; cleaningFeeCents: number },
  nights: number,
  override: { nightlyCents?: number | null; cleaningFeeCents?: number | null } = {},
): BookingAmounts {
  const nightlyCents = override.nightlyCents ?? listing.priceCents;
  const cleaning = override.cleaningFeeCents ?? listing.cleaningFeeCents;
  const p = priceBreakdown(nightlyCents, nights, cleaning);
  return { nights: p.nights, nightlyCents, stayCents: p.stayCents, cleaningFeeCents: p.cleaningFeeCents, serviceFeeCents: p.serviceFeeCents, totalCents: p.totalCents };
}

/**
 * A platform booking whose amount the team knows (from the platform's confirmation): the total as the platform
 * shows it, of which the cleaning fee (0 if not given). The nightly price stored is the average, rounded to the
 * centime: the total stays exactly what was typed, it is never recomputed from the average.
 */
export function platformAmounts(totalCents: number, cleaningFeeCents: number, nights: number): BookingAmounts {
  if (cleaningFeeCents > totalCents) throw new RangeError("cleaning fee above the total");
  const stayCents = totalCents - cleaningFeeCents;
  const nightlyCents = nights > 0 ? Math.round(stayCents / nights) : 0;
  return { nights, nightlyCents, stayCents, cleaningFeeCents, serviceFeeCents: 0, totalCents };
}

/**
 * Amounts after the team changes the dates. A direct booking keeps its nightly price and cleaning fee and is
 * re-priced for the new number of nights; a platform booking keeps the platform's total (it is the platform that
 * re-prices; the next import or e-mail brings the new amount, lot 7); an owner block has none.
 */
export function rescheduledAmounts(
  booking: { source: BookingSource; nightlyCents: number | null; cleaningFeeCents: number | null; serviceFeeCents: number | null; totalCents: number | null },
  nights: number,
): Pick<BookingAmounts, "nightlyCents" | "cleaningFeeCents" | "serviceFeeCents" | "totalCents"> | null {
  if (booking.source === "OWNER" || booking.totalCents === null || booking.nightlyCents === null) return null;
  if (booking.source !== "DIRECT") {
    return { nightlyCents: booking.nightlyCents, cleaningFeeCents: booking.cleaningFeeCents ?? 0, serviceFeeCents: booking.serviceFeeCents ?? 0, totalCents: booking.totalCents };
  }
  const a = directAmounts({ priceCents: booking.nightlyCents, cleaningFeeCents: booking.cleaningFeeCents ?? 0 }, nights);
  return { nightlyCents: a.nightlyCents, cleaningFeeCents: a.cleaningFeeCents, serviceFeeCents: a.serviceFeeCents, totalCents: a.totalCents };
}

// ---------- Form ----------

const required = (label: string) => `${label} : champ obligatoire`;

const textField = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} : ${max} caractères au maximum`)
    .refine((s) => !CONTROL_RE.test(s), `${label} : caractères non autorisés`);

const dateField = (label: string) =>
  z
    .string()
    .trim()
    .min(1, required(label))
    .transform((s, ctx) => {
      const d = parseDay(s);
      if (!d) {
        ctx.addIssue({ code: "custom", message: `${label} : date invalide` });
        return z.NEVER;
      }
      return d;
    });

const countField = (label: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .transform((s) => (s === "" ? String(min) : s))
    .refine((s) => /^\d{1,3}$/.test(s), `${label} : nombre entier attendu`)
    .transform(Number)
    .refine((n) => n >= min && n <= max, `${label} : entre ${min} et ${max}`);

/** An optional amount in dirhams: "" → null. */
const optionalAmount = (label: string) =>
  z
    .string()
    .trim()
    .transform((s, ctx) => {
      if (s === "") return null;
      const c = dirhamsToCentimes(s);
      if (c === null) {
        ctx.addIssue({ code: "custom", message: `${label} : montant en dirhams attendu (ex. 1200 ou 1200,50)` });
        return z.NEVER;
      }
      if (c > ENTRY_LIMITS.maxAmountCents) {
        ctx.addIssue({ code: "custom", message: `${label} : montant trop élevé` });
        return z.NEVER;
      }
      return c;
    });

/** International or Moroccan number: digits, spaces, dots, dashes, brackets, an optional leading +; 6 to 15 digits. */
export const PHONE_RE = /^\+?[0-9 .()-]+$/;
const phoneField = textField("Téléphone", ENTRY_LIMITS.phone).refine((s) => {
  if (s === "") return true;
  const digits = s.replace(/\D/g, "").length;
  return PHONE_RE.test(s) && digits >= 6 && digits <= 15;
}, "Téléphone : numéro invalide (ex. +212 6 12 34 56 78)");

const emailField = textField("E-mail", ENTRY_LIMITS.email).refine((s) => s === "" || z.email().safeParse(s).success, "E-mail : adresse invalide");

const listingField = z.string().trim().min(1, required("Bien")).regex(ID_RE, "Bien : choisissez dans la liste");

const stayFields = {
  listingId: listingField,
  checkIn: dateField("Arrivée"),
  checkOut: dateField("Départ"),
};

const guestCounts = {
  adults: countField("Adultes", 1, ENTRY_LIMITS.guests),
  children: countField("Enfants", 0, ENTRY_LIMITS.guests),
  infants: countField("Bébés", 0, ENTRY_LIMITS.infants),
  pets: countField("Animaux", 0, ENTRY_LIMITS.pets),
};

const checkbox = z
  .string()
  .optional()
  .transform((v) => v === "on" || v === "true");

const directSchema = z
  .object({
    ...stayFields,
    ...guestCounts,
    guestName: textField("Nom du voyageur", ENTRY_LIMITS.name).refine((s) => s.length >= 2, required("Nom du voyageur")),
    guestPhone: phoneField,
    guestEmail: emailField,
    channel: z.enum(CHANNELS, { message: "Canal : choisissez dans la liste" }),
    nightly: optionalAmount("Prix par nuit"),
    cleaning: optionalAmount("Frais de ménage"),
    allowShortStay: checkbox,
    note: textField("Note", ENTRY_LIMITS.note),
  })
  .superRefine((v, ctx) => {
    if (v.guestPhone === "" && v.guestEmail === "") {
      ctx.addIssue({ code: "custom", path: ["guestPhone"], message: "Téléphone : indiquez un téléphone ou un e-mail pour joindre le voyageur" });
    }
  });

const platformSchema = z
  .object({
    ...stayFields,
    ...guestCounts,
    source: z.enum(PLATFORM_SOURCES, { message: "Plateforme : choisissez dans la liste" }),
    externalRef: textField("Référence de la plateforme", ENTRY_LIMITS.externalRef)
      .refine((s) => s.length > 0, required("Référence de la plateforme"))
      .refine((s) => /^[A-Za-z0-9._\-/#]+$/.test(s), "Référence de la plateforme : lettres, chiffres et . _ - / # seulement"),
    guestName: textField("Nom du voyageur", ENTRY_LIMITS.name),
    guestPhone: phoneField,
    guestEmail: emailField,
    total: optionalAmount("Montant total"),
    cleaning: optionalAmount("Dont frais de ménage"),
    note: textField("Note", ENTRY_LIMITS.note),
  })
  .superRefine((v, ctx) => {
    if (v.total === null && v.cleaning !== null) {
      ctx.addIssue({ code: "custom", path: ["total"], message: "Montant total : obligatoire avec les frais de ménage" });
    }
    if (v.total !== null && v.total <= 0) ctx.addIssue({ code: "custom", path: ["total"], message: "Montant total : supérieur à 0 MAD" });
    if (v.total !== null && v.cleaning !== null && v.cleaning > v.total) {
      ctx.addIssue({ code: "custom", path: ["cleaning"], message: "Dont frais de ménage : pas plus que le montant total" });
    }
  });

const ownerSchema = z.object({
  ...stayFields,
  note: textField("Motif", ENTRY_LIMITS.note).refine((s) => s.length >= 2, required("Motif")),
});

const rescheduleSchema = z.object({
  checkIn: dateField("Arrivée"),
  checkOut: dateField("Départ"),
  allowShortStay: checkbox,
});

export type DirectEntry = z.output<typeof directSchema>;
export type PlatformEntry = z.output<typeof platformSchema>;
export type OwnerEntry = z.output<typeof ownerSchema>;
export type Reschedule = z.output<typeof rescheduleSchema>;

export type BookingEntry = ({ kind: "directe" } & DirectEntry) | ({ kind: "plateforme" } & PlatformEntry) | ({ kind: "blocage" } & OwnerEntry);

export const ENTRY_FIELDS = [
  "listingId",
  "checkIn",
  "checkOut",
  "adults",
  "children",
  "infants",
  "pets",
  "guestName",
  "guestPhone",
  "guestEmail",
  "channel",
  "nightly",
  "cleaning",
  "allowShortStay",
  "source",
  "externalRef",
  "total",
  "note",
] as const;

export type EntryFieldName = (typeof ENTRY_FIELDS)[number];
export type EntryFieldErrors = Partial<Record<EntryFieldName, string>>;
export type EntryValues = Partial<Record<EntryFieldName, string>>;

/** The raw form values, as strings; a missing checkbox is "". Anything else in the FormData is ignored. */
export function entryFormValues(form: FormData): EntryValues {
  return Object.fromEntries(ENTRY_FIELDS.map((k) => [k, typeof form.get(k) === "string" ? (form.get(k) as string) : ""]));
}

function fieldErrors(error: z.ZodError): EntryFieldErrors {
  const out: EntryFieldErrors = {};
  for (const issue of error.issues) {
    const key = (issue.path[0] ?? "listingId") as EntryFieldName;
    out[key] ??= issue.message.includes(" : ") ? issue.message : `${key} : valeur invalide`;
  }
  return out;
}

/** Departure after arrival, at most maxNights. */
function checkRange(checkIn: Date, checkOut: Date): EntryFieldErrors {
  if (checkOut <= checkIn) return { checkOut: "Départ : après l'arrivée" };
  if (nightsBetween(checkIn, checkOut) > ENTRY_LIMITS.maxNights) return { checkOut: `Départ : ${ENTRY_LIMITS.maxNights} nuits au maximum` };
  return {};
}

export type ParsedEntry = { ok: true; entry: BookingEntry } | { ok: false; fieldErrors: EntryFieldErrors };

/** Every field as a string (missing ones ""), the checkbox as on/absent. */
function normalize(values: EntryValues) {
  const v: Record<string, string | undefined> = Object.fromEntries(ENTRY_FIELDS.map((k) => [k, values[k] ?? ""]));
  v.allowShortStay = values.allowShortStay || undefined;
  return v;
}

export function parseEntryForm(kind: EntryKind, values: EntryValues): ParsedEntry {
  const v = normalize(values);
  const parsed = kind === "directe" ? directSchema.safeParse(v) : kind === "plateforme" ? platformSchema.safeParse(v) : ownerSchema.safeParse(v);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const range = checkRange(parsed.data.checkIn, parsed.data.checkOut);
  if (Object.keys(range).length) return { ok: false, fieldErrors: range };
  return { ok: true, entry: { kind, ...parsed.data } as BookingEntry };
}

export type ParsedReschedule = { ok: true; input: Reschedule } | { ok: false; fieldErrors: EntryFieldErrors };

export function parseRescheduleForm(values: EntryValues): ParsedReschedule {
  const parsed = rescheduleSchema.safeParse(normalize(values));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const range = checkRange(parsed.data.checkIn, parsed.data.checkOut);
  if (Object.keys(range).length) return { ok: false, fieldErrors: range };
  return { ok: true, input: parsed.data };
}

/** Centimes back to the form's dirhams ("" for none). */
export function amountValue(c: number | null | undefined): string {
  return c === null || c === undefined ? "" : centimesToDirhams(c);
}
