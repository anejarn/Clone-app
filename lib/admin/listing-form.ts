import { z } from "zod";
import { PROPERTY_TYPE_LABEL, type PropertyTypeKey } from "@/lib/labels";
import { bpsToPercent, centimesToDirhams, dirhamsToCentimes, percentToBps } from "@/lib/money";
import { CONTROL_RE, ID_RE } from "@/lib/server/schemas";

/**
 * The back-office listing form (create and edit), validated on the server by the actions in
 * app/admin/biens/actions.ts. Fields arrive as FormData strings; amounts are typed in dirhams and percent and
 * stored as centimes and basis points (lib/money.ts). Rules that need the database (the owner is an OWNER of the
 * organization, the neighbourhood and amenities exist, publishing needs a photo) are checked in
 * lib/server/admin/listings.ts.
 */

export const MANAGEMENT_TYPE_LABEL = { MANAGED: "Mandat de gestion", SUBLEASE: "Sous-location" } as const;
export const LISTING_STATUS_LABEL = { DRAFT: "Brouillon", PUBLISHED: "Publié" } as const;

export const LIMITS = {
  title: 120,
  description: 5000,
  houseRules: 3000,
  address: 300,
  city: 80,
  licenseNumber: 60,
  maxGuests: 50,
  rooms: 50,
  beds: 100,
  minNights: 365,
  /** 1 000 000 MAD a night, in centimes: far above any real price, well inside a Postgres integer. */
  maxPriceCents: 100_000_000,
} as const;

const PROPERTY_TYPES = Object.keys(PROPERTY_TYPE_LABEL) as [PropertyTypeKey, ...PropertyTypeKey[]];

const required = (label: string) => `${label} : champ obligatoire`;

function intField(label: string, min: number, max: number) {
  return z
    .string()
    .trim()
    .min(1, required(label))
    .regex(/^\d+$/, `${label} : nombre entier attendu`)
    .transform(Number)
    .refine((n) => n >= min && n <= max, `${label} : entre ${min} et ${max}`);
}

function decimalField(label: string, min: number, max: number) {
  return z
    .string()
    .trim()
    .min(1, required(label))
    .transform((s) => s.replace(",", "."))
    .refine((s) => /^-?\d{1,3}(\.\d{1,8})?$/.test(s), `${label} : nombre décimal attendu (ex. 31,6295)`)
    .transform(Number)
    .refine((n) => n >= min && n <= max, `${label} : entre ${min} et ${max}`);
}

function amountField(label: string, { optional = false, min = 0 } = {}) {
  return z
    .string()
    .trim()
    .transform((s, ctx) => {
      if (s === "" && optional) return 0;
      if (s === "") {
        ctx.addIssue({ code: "custom", message: required(label) });
        return z.NEVER;
      }
      const c = dirhamsToCentimes(s);
      if (c === null) {
        ctx.addIssue({ code: "custom", message: `${label} : montant en dirhams attendu (ex. 1200 ou 1200,50)` });
        return z.NEVER;
      }
      return c;
    })
    .refine((c) => c >= min, `${label} : ${min / 100} MAD minimum`)
    .refine((c) => c <= LIMITS.maxPriceCents, `${label} : montant trop élevé`);
}

/** A calendar date as sent by <input type="date"> (yyyy-MM-dd), as a UTC midnight (@db.Date). */
export function parseDateInput(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d;
}

const textField = (label: string, max: number, min = 0) =>
  z
    .string()
    .trim()
    .max(max, `${label} : ${max} caractères au maximum`)
    .refine((s) => !CONTROL_RE.test(s), `${label} : caractères non autorisés`)
    .refine((s) => s.length >= min, min === 1 ? required(label) : `${label} : au moins ${min} caractères`);

/** A choice among ids (select): required, and well-formed (anything else cannot exist). */
const choiceField = (label: string) =>
  z
    .string()
    .trim()
    .min(1, required(label))
    .regex(ID_RE, `${label} : choisissez dans la liste`);

export const listingFormSchema = z
  .object({
    title: textField("Titre", LIMITS.title, 3),
    description: textField("Description", LIMITS.description, 1),
    propertyType: z.enum(PROPERTY_TYPES, { message: "Type de logement : choisissez dans la liste" }),
    maxGuests: intField("Voyageurs", 1, LIMITS.maxGuests),
    bedrooms: intField("Chambres", 0, LIMITS.rooms),
    beds: intField("Lits", 0, LIMITS.beds),
    bathrooms: z
      .string()
      .trim()
      .min(1, required("Salles de bain"))
      .transform((s) => s.replace(",", "."))
      .refine((s) => /^\d{1,2}(\.[05])?$/.test(s), "Salles de bain : nombre entier ou demi (ex. 1,5)")
      .transform(Number)
      .refine((n) => n <= LIMITS.rooms, `Salles de bain : ${LIMITS.rooms} au maximum`),
    placeId: choiceField("Quartier"),
    address: textField("Adresse", LIMITS.address, 3),
    city: textField("Ville", LIMITS.city, 2),
    lat: decimalField("Latitude", -90, 90),
    lng: decimalField("Longitude", -180, 180),
    amenityIds: z.array(z.string().regex(ID_RE, "Équipements : choisissez dans la liste")).max(100, "Équipements : 100 au maximum"),
    houseRules: textField("Règlement intérieur", LIMITS.houseRules),
    ownerId: choiceField("Propriétaire"),
    managementType: z.enum(["MANAGED", "SUBLEASE"], { message: "Type de gestion : choisissez dans la liste" }),
    commission: z.string().trim(),
    licenseNumber: textField("Numéro d'autorisation", LIMITS.licenseNumber),
    licenseExpiresAt: z.string().trim(),
    minNights: intField("Séjour minimum", 1, LIMITS.minNights),
    price: amountField("Prix par nuit", { min: 100 }),
    cleaningFee: amountField("Frais de ménage", { optional: true }),
    status: z.enum(["DRAFT", "PUBLISHED"], { message: "Statut : choisissez dans la liste" }),
  })
  .transform((v, ctx) => {
    // Commission: required for a management mandate; a sub-let has none (listings_sublease_commission_check).
    let commissionBps = 0;
    if (v.managementType === "MANAGED") {
      const bps = v.commission === "" ? null : percentToBps(v.commission.replace(/\s*%$/, ""));
      if (v.commission === "") ctx.addIssue({ code: "custom", path: ["commission"], message: required("Commission") });
      else if (bps === null || bps > 10_000) {
        ctx.addIssue({ code: "custom", path: ["commission"], message: "Commission : pourcentage entre 0 et 100 (ex. 20 ou 17,5)" });
      } else commissionBps = bps;
    }
    // Loi 80-14: number and expiry date go together.
    let licenseExpiresAt: Date | null = null;
    if (v.licenseExpiresAt !== "") {
      licenseExpiresAt = parseDateInput(v.licenseExpiresAt);
      if (!licenseExpiresAt) ctx.addIssue({ code: "custom", path: ["licenseExpiresAt"], message: "Date d'expiration : date invalide" });
    }
    if (v.licenseNumber !== "" && v.licenseExpiresAt === "") {
      ctx.addIssue({ code: "custom", path: ["licenseExpiresAt"], message: "Date d'expiration : obligatoire avec un numéro d'autorisation" });
    }
    if (v.licenseNumber === "" && v.licenseExpiresAt !== "") {
      ctx.addIssue({ code: "custom", path: ["licenseNumber"], message: "Numéro d'autorisation : obligatoire avec une date d'expiration" });
    }
    const { commission: _c, price, cleaningFee, licenseNumber, amenityIds, ...rest } = v;
    void _c;
    return {
      ...rest,
      amenityIds: [...new Set(amenityIds)],
      commissionBps,
      licenseNumber: licenseNumber === "" ? null : licenseNumber,
      licenseExpiresAt,
      priceCents: price,
      cleaningFeeCents: cleaningFee,
    };
  });

export type ListingInput = z.output<typeof listingFormSchema>;

/** Form field names, as in the HTML form; FormData entries outside this list are ignored. */
export const LISTING_FIELDS = [
  "title",
  "description",
  "propertyType",
  "maxGuests",
  "bedrooms",
  "beds",
  "bathrooms",
  "placeId",
  "address",
  "city",
  "lat",
  "lng",
  "houseRules",
  "ownerId",
  "managementType",
  "commission",
  "licenseNumber",
  "licenseExpiresAt",
  "minNights",
  "price",
  "cleaningFee",
  "status",
] as const;

export type ListingFieldName = (typeof LISTING_FIELDS)[number] | "amenityIds";
export type FieldErrors = Partial<Record<ListingFieldName, string>>;

/** The raw form values: strings (missing fields as ""), and the checked amenities. Files are never values. */
export function listingFormValues(form: FormData): Record<string, unknown> {
  const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : "");
  const values: Record<string, unknown> = Object.fromEntries(LISTING_FIELDS.map((k) => [k, str(form.get(k))]));
  values.amenityIds = form.getAll("amenityIds").filter((v): v is string => typeof v === "string");
  return values;
}

export type ParsedListing = { ok: true; input: ListingInput } | { ok: false; fieldErrors: FieldErrors };

/** Validates the form; on failure, the first message of each field. */
export function parseListingForm(values: unknown): ParsedListing {
  const parsed = listingFormSchema.safeParse(values);
  if (parsed.success) return { ok: true, input: parsed.data };
  const fieldErrors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    const key = (issue.path[0] ?? "title") as ListingFieldName;
    fieldErrors[key] ??= issue.message.includes(" : ") ? issue.message : `${key} : valeur invalide`;
  }
  return { ok: false, fieldErrors };
}

export type FormValues = Record<string, string | string[]>;

/** A listing as form values (amounts back in dirhams and percent, dates as yyyy-MM-dd). */
export function listingToFormValues(l: {
  title: string;
  description: string;
  propertyType: string | null;
  maxGuests: number;
  bedrooms: number;
  beds: number;
  bathrooms: number;
  placeId: string;
  address: string;
  city: string;
  lat: number;
  lng: number;
  houseRules: string;
  ownerId: string;
  managementType: string;
  commissionBps: number;
  licenseNumber: string | null;
  licenseExpiresAt: Date | null;
  minNights: number;
  priceCents: number;
  cleaningFeeCents: number;
  status: string;
  amenityIds: string[];
}): FormValues {
  return {
    title: l.title,
    description: l.description,
    propertyType: l.propertyType ?? "",
    maxGuests: String(l.maxGuests),
    bedrooms: String(l.bedrooms),
    beds: String(l.beds),
    bathrooms: String(l.bathrooms).replace(".", ","),
    placeId: l.placeId,
    address: l.address,
    city: l.city,
    lat: String(l.lat).replace(".", ","),
    lng: String(l.lng).replace(".", ","),
    houseRules: l.houseRules,
    ownerId: l.ownerId,
    managementType: l.managementType,
    commission: l.managementType === "SUBLEASE" ? "" : bpsToPercent(l.commissionBps),
    licenseNumber: l.licenseNumber ?? "",
    licenseExpiresAt: l.licenseExpiresAt ? l.licenseExpiresAt.toISOString().slice(0, 10) : "",
    minNights: String(l.minNights),
    price: centimesToDirhams(l.priceCents),
    cleaningFee: centimesToDirhams(l.cleaningFeeCents),
    status: l.status,
    amenityIds: l.amenityIds,
  };
}

/** A new listing's form: the organization's default commission, a management mandate, one night, a draft. */
export function newListingFormValues(defaultCommissionBps: number): FormValues {
  return {
    managementType: "MANAGED",
    commission: bpsToPercent(defaultCommissionBps),
    city: "Marrakech",
    minNights: "1",
    maxGuests: "2",
    bedrooms: "1",
    beds: "1",
    bathrooms: "1",
    cleaningFee: "0",
    status: "DRAFT",
    amenityIds: [],
  };
}
