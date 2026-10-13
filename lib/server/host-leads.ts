import "server-only";
import { z } from "zod";
import { REGISTRATION_NUMBER_RE, registrationCommune } from "@/lib/registration";
import { db } from "./db";
import { AppError } from "./errors";
import { text } from "./schemas";

/** Property types an owner can offer: the ones the catalogue lists. */
export const HOST_LEAD_PROPERTY_TYPES = ["APARTMENT", "STUDIO", "CHALET"] as const;

/** Cap on the request body: the longest valid lead (a 2,000-character message) is far below it. */
export const HOST_LEAD_MAX_BYTES = 16 * 1024;

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
});

export type HostLeadInput = z.infer<typeof hostLeadInputSchema>;

/** Stores an owner's request to list with Nidou. Returns nothing the caller could echo. */
export async function createHostLead(input: HostLeadInput): Promise<void> {
  const place = await db.place.findUnique({ where: { slug: input.placeSlug }, select: { inseeCode: true } });
  if (!place) throw new AppError(400, "INVALID_INPUT", "placeSlug : station inconnue.");
  if (input.registrationNumber && registrationCommune(input.registrationNumber) !== place.inseeCode) {
    throw new AppError(400, "INVALID_INPUT", "registrationNumber : ce numéro n'est pas celui d'un logement de cette station.");
  }
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
