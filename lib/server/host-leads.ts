import "server-only";
import { z } from "zod";
import { HOST_LEAD_HONEYPOT } from "@/lib/host-lead";
import { REGISTRATION_NUMBER_RE, registrationCommune } from "@/lib/registration";
import { db } from "./db";
import { AppError } from "./errors";
import { text } from "./schemas";

/** Property types an owner can offer: the ones the catalogue lists. */
export const HOST_LEAD_PROPERTY_TYPES = ["APARTMENT", "STUDIO", "CHALET"] as const;

/** Cap on the request body: the longest valid lead (a 2,000-character message) is far below it. */
export const HOST_LEAD_MAX_BYTES = 16 * 1024;

/** Honeypot field name (shared with the form): a request that fills it is answered as usual, nothing stored. */
export { HOST_LEAD_HONEYPOT };

/** Per client IP: at most this many requests per window, per server instance (see rate-limit.ts). */
export const HOST_LEAD_RATE_LIMIT = { limit: 10, windowMs: 10 * 60 * 1000 };

/** The same email for the same resort within this window is answered as usual but not stored again. */
export const HOST_LEAD_DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

const optionalText = (max: number) =>
  text(max)
    .optional()
    .transform((s) => s || undefined);

/** Strict: unknown keys are refused rather than silently dropped. */
export const hostLeadInputSchema = z.strictObject({
  name: text(100).pipe(z.string().min(1)),
  email: text(254).toLowerCase().pipe(z.email("Adresse e-mail invalide")),
  phone: optionalText(30).refine((s) => s === undefined || /^\+?[0-9 .()-]{6,}$/.test(s), "Numéro de téléphone invalide"),
  placeSlug: text(80).pipe(z.string().min(1)),
  propertyType: z.enum(HOST_LEAD_PROPERTY_TYPES),
  beds: z.number().int().min(1).max(30),
  openWinterWeeks: z.number().int().min(1).max(26),
  // Spaces are tolerated and letters upper-cased before the format check.
  registrationNumber: z
    .string()
    .max(40)
    .optional()
    .transform((s) => s?.replace(/\s+/g, "").toUpperCase() || undefined)
    .refine((s) => s === undefined || REGISTRATION_NUMBER_RE.test(s), "Numéro d'enregistrement invalide (13 caractères attendus)"),
  message: optionalText(2000),
  consent: z.literal(true, "Votre accord est nécessaire pour être recontacté."),
  // Any value is accepted, so validation never tells a script that this field is special; the body cap bounds it.
  [HOST_LEAD_HONEYPOT]: z.unknown().optional(),
});

export type HostLeadInput = z.infer<typeof hostLeadInputSchema>;

/** People leave the honeypot empty (the form sends ""); anything else, of any type, is a script. */
function honeypotFilled(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  return typeof value === "string" ? value.trim() !== "" : true;
}

/**
 * Stores an owner's request to list with Nidou. Returns nothing the caller could echo, and behaves the same
 * when it stores nothing: a filled honeypot, or the same email and resort already received in the last 24 hours.
 */
export async function createHostLead(input: HostLeadInput, now = new Date()): Promise<void> {
  if (honeypotFilled(input[HOST_LEAD_HONEYPOT])) return;
  const place = await db.place.findUnique({ where: { slug: input.placeSlug }, select: { inseeCode: true } });
  if (!place) throw new AppError(400, "INVALID_INPUT", "placeSlug : station inconnue.");
  if (input.registrationNumber && registrationCommune(input.registrationNumber) !== place.inseeCode) {
    throw new AppError(400, "INVALID_INPUT", "registrationNumber : ce numéro n'est pas celui d'un logement de cette station.");
  }
  const duplicate = await db.hostLead.findFirst({
    where: { email: input.email, placeSlug: input.placeSlug, createdAt: { gt: new Date(now.getTime() - HOST_LEAD_DUPLICATE_WINDOW_MS) } },
    select: { id: true },
  });
  if (duplicate) return;
  await db.hostLead.create({
    data: {
      name: input.name,
      email: input.email,
      phone: input.phone ?? null,
      placeSlug: input.placeSlug,
      propertyType: input.propertyType,
      beds: input.beds,
      openWinterWeeks: input.openWinterWeeks,
      registrationNumber: input.registrationNumber ?? null,
      message: input.message ?? null,
      consent: input.consent,
    },
    select: { id: true },
  });
}
