import { REGISTRATION_NUMBER_RE, registrationCommune } from "./registration";

/**
 * Client-side checks of the owner form on /devenir-hote. They mirror the server's schema
 * (lib/server/host-leads.ts), which stays the authority; this only gives French messages next to each field
 * before anything is sent.
 */

export const HOST_LEAD_TYPES = [
  { value: "APARTMENT", label: "Appartement" },
  { value: "STUDIO", label: "Studio" },
  { value: "CHALET", label: "Chalet" },
] as const;

export const HOST_LEAD_LIMITS = { name: 100, email: 254, phone: 30, message: 2000, beds: [1, 30], openWinterWeeks: [1, 26] } as const;

export type HostLeadField =
  | "name"
  | "email"
  | "phone"
  | "placeSlug"
  | "propertyType"
  | "beds"
  | "openWinterWeeks"
  | "registrationNumber"
  | "message"
  | "consent";

/** Raw form values (strings from inputs, a boolean for the checkbox). */
export type HostLeadValues = Record<Exclude<HostLeadField, "consent">, string> & { consent: boolean };

/** The JSON body POST /api/host-leads accepts. */
export interface HostLeadPayload {
  name: string;
  email: string;
  phone?: string;
  placeSlug: string;
  propertyType: string;
  beds: number;
  openWinterWeeks: number;
  registrationNumber?: string;
  message?: string;
  consent: true;
}

/** Same normalisation as the server: spaces removed, letters upper-cased. */
export function normaliseRegistration(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

function intIn(value: string, [min, max]: readonly [number, number]): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
}

/**
 * Field order is the form's order, so the first key of `errors` is the first field to fix.
 * `places` maps each resort slug to its commune INSEE code (registration numbers must start with it).
 */
export function validateHostLead(
  v: HostLeadValues,
  places: Record<string, string>,
): { payload: HostLeadPayload; errors?: undefined } | { payload?: undefined; errors: Partial<Record<HostLeadField, string>> } {
  const errors: Partial<Record<HostLeadField, string>> = {};
  const name = v.name.trim();
  const email = v.email.trim();
  const phone = v.phone.trim();
  const registration = normaliseRegistration(v.registrationNumber);
  const message = v.message.trim();

  if (!name) errors.name = "Indiquez votre nom.";
  else if (name.length > HOST_LEAD_LIMITS.name) errors.name = `${HOST_LEAD_LIMITS.name} caractères maximum.`;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > HOST_LEAD_LIMITS.email) errors.email = "Indiquez une adresse e-mail valide.";
  if (phone && (phone.length > HOST_LEAD_LIMITS.phone || !/^\+?[0-9 .()-]{6,}$/.test(phone))) errors.phone = "Indiquez un numéro de téléphone valide, ou laissez ce champ vide.";
  if (!(v.placeSlug in places)) errors.placeSlug = "Choisissez la station.";
  if (!HOST_LEAD_TYPES.some((t) => t.value === v.propertyType)) errors.propertyType = "Choisissez le type de logement.";
  const beds = intIn(v.beds, HOST_LEAD_LIMITS.beds);
  if (beds === null) errors.beds = `Indiquez un nombre de lits entre ${HOST_LEAD_LIMITS.beds[0]} et ${HOST_LEAD_LIMITS.beds[1]}.`;
  const weeks = intIn(v.openWinterWeeks, HOST_LEAD_LIMITS.openWinterWeeks);
  if (weeks === null) {
    errors.openWinterWeeks = `Indiquez un nombre de semaines entre ${HOST_LEAD_LIMITS.openWinterWeeks[0]} et ${HOST_LEAD_LIMITS.openWinterWeeks[1]}.`;
  }
  if (registration) {
    if (!REGISTRATION_NUMBER_RE.test(registration)) {
      errors.registrationNumber = "Le numéro d'enregistrement compte 13 caractères\u00a0: 5 chiffres, 6 chiffres puis 2 lettres.";
    } else if (v.placeSlug in places && registrationCommune(registration) !== places[v.placeSlug]) {
      errors.registrationNumber = `Ce numéro ne correspond pas à la station choisie\u00a0: il doit commencer par ${places[v.placeSlug]}.`;
    }
  }
  if (message.length > HOST_LEAD_LIMITS.message) errors.message = `${HOST_LEAD_LIMITS.message} caractères maximum.`;
  if (!v.consent) errors.consent = "Votre accord est nécessaire pour que nous puissions vous recontacter.";

  if (Object.keys(errors).length > 0) return { errors };
  return {
    payload: {
      name,
      email,
      ...(phone && { phone }),
      placeSlug: v.placeSlug,
      propertyType: v.propertyType,
      beds: beds!,
      openWinterWeeks: weeks!,
      ...(registration && { registrationNumber: registration }),
      ...(message && { message }),
      consent: true,
    },
  };
}

/** API errors read "<field> : <message>" (lib/server/http.ts): returns the field when it is one of the form's. */
export function errorField(message: string): HostLeadField | null {
  const field = /^(\w+) : /.exec(message)?.[1];
  const fields: HostLeadField[] = ["name", "email", "phone", "placeSlug", "propertyType", "beds", "openWinterWeeks", "registrationNumber", "message", "consent"];
  return fields.find((f) => f === field) ?? null;
}
