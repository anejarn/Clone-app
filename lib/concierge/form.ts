import { z } from "zod";
import type { PartnerChannel, ServiceCategory, ServicePaymentMethod, ServicePricingModel } from "@/lib/generated/prisma/enums";
import { GUEST_LOCALES } from "@/lib/i18n/locales";
import { readLocalized, type Localized } from "@/lib/i18n/localized";
import { dirhamsToCentimes } from "@/lib/money";
import { CONTROL_RE, ID_RE } from "@/lib/server/schemas";
import { PARTNER_CHANNELS, PAYMENT_METHODS, PRICING_MODELS, SERVICE_CATEGORIES } from "./catalog";
import { MAX_TOTAL_CENTS, MAX_UNIT_CENTS } from "./pricing";

/**
 * Back-office forms of the conciergerie (partners, services, a request's final price and payment), validated on the
 * server by app/admin/conciergerie/**\/actions.ts. Pure. Amounts are typed in dirhams ("350", "1 250,50") and stored
 * in centimes (lib/money.ts). Texts in several languages come as `<field>_fr`, `_es`, `_en` (French required for the
 * title). A service's options come as rows `option<i>_<field>` (i = 0 … MAX_OPTIONS − 1); a row without a French
 * label is ignored.
 */

export const CONCIERGE_LIMITS = {
  partnerName: 120,
  partnerNotes: 2000,
  phone: 40,
  email: 200,
  title: 120,
  description: 2000,
  availability: 600,
  optionLabel: 80,
  leadTimeHours: 720,
  internalNote: 2000,
} as const;
export const MAX_OPTIONS = 6;

export type FieldErrors = Record<string, string>;
export type ParseResult<T> = { ok: true; input: T } | { ok: false; fieldErrors: FieldErrors };

const str = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} : ${max} caractères au maximum`)
    .refine((s) => !CONTROL_RE.test(s), `${label} : caractères non autorisés`);

function errorsOf(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) out[String(issue.path[0] ?? "form")] ??= issue.message;
  return out;
}

/** Phone / WhatsApp as typed: digits, spaces, + ( ) . - ; at least 6 digits. Empty = none. */
const PHONE_RE = /^\+?[\d\s().-]{6,40}$/;
export function isPhone(s: string): boolean {
  return PHONE_RE.test(s) && (s.match(/\d/g)?.length ?? 0) >= 6;
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function localizedField(values: Record<string, string>, field: string, label: string, max: number, errors: FieldErrors): Localized {
  const out: Localized = {};
  for (const l of GUEST_LOCALES) {
    const key = `${field}_${l}`;
    const r = str(`${label} (${l})`, max).safeParse(values[key] ?? "");
    if (!r.success) errors[key] ??= r.error.issues[0].message;
    else if (r.data) out[l] = r.data;
  }
  return out;
}

function amountOf(raw: string, label: string, max = MAX_UNIT_CENTS): { cents: number } | { error: string } {
  const t = raw.trim();
  if (!t) return { error: `${label} : indiquez un montant en dirhams` };
  const c = dirhamsToCentimes(t);
  if (c === null) return { error: `${label} : un montant en dirhams, par exemple 350 ou 1 250,50` };
  if (c > max) return { error: `${label} : ${max / 100} MAD au maximum` };
  return { cents: c };
}

function amount(values: Record<string, string>, key: string, label: string, errors: FieldErrors, max = MAX_UNIT_CENTS): number | null {
  const r = amountOf(values[key] ?? "", label, max);
  if ("error" in r) {
    errors[key] ??= r.error;
    return null;
  }
  return r.cents;
}

// ---------- Partners ----------

export interface PartnerInput {
  name: string;
  type: ServiceCategory;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  preferredChannel: PartnerChannel;
  notes: string;
  active: boolean;
}

export function parsePartnerForm(values: Record<string, string>): ParseResult<PartnerInput> {
  const schema = z.object({
    name: str("Nom", CONCIERGE_LIMITS.partnerName).refine((s) => s.length > 0, "Nom : champ obligatoire"),
    type: z.enum(SERVICE_CATEGORIES, { message: "Activité : choisissez dans la liste" }),
    phone: str("Téléphone", CONCIERGE_LIMITS.phone).refine((s) => s === "" || isPhone(s), "Téléphone : un numéro, par exemple +212 6 00 00 00 00"),
    whatsapp: str("WhatsApp", CONCIERGE_LIMITS.phone).refine((s) => s === "" || isPhone(s), "WhatsApp : un numéro, par exemple +212 6 00 00 00 00"),
    email: str("E-mail", CONCIERGE_LIMITS.email).refine((s) => s === "" || EMAIL_RE.test(s), "E-mail : une adresse, par exemple contact@exemple.ma"),
    preferredChannel: z.enum(PARTNER_CHANNELS, { message: "Canal préféré : choisissez dans la liste" }),
    notes: str("Notes", CONCIERGE_LIMITS.partnerNotes),
  });
  const r = schema.safeParse({
    name: values.name ?? "",
    type: values.type ?? "",
    phone: values.phone ?? "",
    whatsapp: values.whatsapp ?? "",
    email: values.email ?? "",
    preferredChannel: values.preferredChannel || "WHATSAPP",
    notes: values.notes ?? "",
  });
  if (!r.success) return { ok: false, fieldErrors: errorsOf(r.error) };
  const d = r.data;
  if (!d.phone && !d.whatsapp && !d.email) return { ok: false, fieldErrors: { phone: "Contact : indiquez au moins un téléphone, un WhatsApp ou un e-mail" } };
  const contact = { WHATSAPP: d.whatsapp, EMAIL: d.email, PHONE: d.phone }[d.preferredChannel];
  if (!contact) return { ok: false, fieldErrors: { preferredChannel: "Canal préféré : renseignez le contact correspondant" } };
  return {
    ok: true,
    input: { name: d.name, type: d.type, phone: d.phone || null, whatsapp: d.whatsapp || null, email: d.email.toLowerCase() || null, preferredChannel: d.preferredChannel, notes: d.notes, active: values.active === "on" },
  };
}

// ---------- Services ----------

/** An option of a service, as stored in services.options. */
export interface ServiceOption {
  id: string;
  label: Localized;
  saleCents: number;
  partnerCents: number;
  perUnit: boolean;
}

export interface ServiceInput {
  partnerId: string;
  category: ServiceCategory;
  title: Localized;
  description: Localized;
  availability: Localized;
  pricingModel: ServicePricingModel;
  salePriceCents: number | null;
  partnerPriceCents: number | null;
  options: ServiceOption[];
  leadTimeHours: number;
  position: number;
  active: boolean;
}

const OPTION_ID_RE = /^[a-z0-9]{1,16}$/;

function newOptionId(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 10);
}

export function parseServiceForm(values: Record<string, string>, newId: () => string = newOptionId): ParseResult<ServiceInput> {
  const errors: FieldErrors = {};
  const partnerId = (values.partnerId ?? "").trim();
  if (!ID_RE.test(partnerId)) errors.partnerId = "Partenaire : choisissez dans la liste";
  const category = z.enum(SERVICE_CATEGORIES).safeParse(values.category ?? "");
  if (!category.success) errors.category = "Catégorie : choisissez dans la liste";
  const pricingModel = z.enum(PRICING_MODELS).safeParse(values.pricingModel ?? "");
  if (!pricingModel.success) errors.pricingModel = "Tarification : choisissez dans la liste";
  const title = localizedField(values, "title", "Titre", CONCIERGE_LIMITS.title, errors);
  if (!title.fr && !errors.title_fr) errors.title_fr = "Titre (français) : champ obligatoire";
  const description = localizedField(values, "description", "Description", CONCIERGE_LIMITS.description, errors);
  const availability = localizedField(values, "availability", "Disponibilités", CONCIERGE_LIMITS.availability, errors);

  let salePriceCents: number | null = null;
  let partnerPriceCents: number | null = null;
  if (pricingModel.success && pricingModel.data !== "ON_QUOTE") {
    salePriceCents = amount(values, "salePrice", "Prix de vente", errors);
    partnerPriceCents = amount(values, "partnerPrice", "Prix partenaire", errors);
    if (salePriceCents !== null && partnerPriceCents !== null && partnerPriceCents > salePriceCents) {
      errors.partnerPrice = "Prix partenaire : supérieur au prix de vente (marge négative)";
    }
  }

  const lead = (values.leadTimeHours ?? "").trim() || "0";
  const leadTimeHours = /^\d{1,4}$/.test(lead) ? Number(lead) : NaN;
  if (!(leadTimeHours >= 0 && leadTimeHours <= CONCIERGE_LIMITS.leadTimeHours)) errors.leadTimeHours = `Délai de prévenance : un nombre d'heures entre 0 et ${CONCIERGE_LIMITS.leadTimeHours}`;
  const pos = (values.position ?? "").trim() || "0";
  const position = /^\d{1,4}$/.test(pos) ? Number(pos) : NaN;
  if (!Number.isInteger(position)) errors.position = "Ordre : un nombre entre 0 et 9999";

  const options: ServiceOption[] = [];
  for (let i = 0; i < MAX_OPTIONS; i++) {
    const p = `option${i}_`;
    const label = localizedField(values, `${p}label`, `Option ${i + 1}`, CONCIERGE_LIMITS.optionLabel, errors);
    if (!label.fr) continue;
    const id = (values[`${p}id`] ?? "").trim();
    const sale = amountOf((values[`${p}sale`] ?? "").trim() || "0", `Option ${i + 1}, prix de vente`);
    const partner = amountOf((values[`${p}partner`] ?? "").trim() || "0", `Option ${i + 1}, prix partenaire`);
    if ("error" in sale) errors[`${p}sale`] ??= sale.error;
    if ("error" in partner) errors[`${p}partner`] ??= partner.error;
    if ("error" in sale || "error" in partner) continue;
    const saleCents = sale.cents;
    const partnerCents = partner.cents;
    if (partnerCents > saleCents) {
      errors[`${p}partner`] = `Option ${i + 1} : prix partenaire supérieur au prix de vente`;
      continue;
    }
    options.push({ id: OPTION_ID_RE.test(id) && !options.some((o) => o.id === id) ? id : newId(), label, saleCents, partnerCents, perUnit: values[`${p}perUnit`] === "on" });
  }
  if (pricingModel.success && pricingModel.data === "ON_QUOTE" && options.some((o) => o.saleCents > 0 || o.partnerCents > 0)) {
    errors.option0_sale = "Sur devis : les options n'ont pas de prix (le devis les comprend)";
  }

  if (Object.keys(errors).length || !category.success || !pricingModel.success) return { ok: false, fieldErrors: errors };
  return {
    ok: true,
    input: { partnerId, category: category.data, title, description, availability, pricingModel: pricingModel.data, salePriceCents, partnerPriceCents, options, leadTimeHours, position, active: values.active === "on" },
  };
}

/** services.options read back from the database: well-formed entries only. */
export function readServiceOptions(value: unknown): ServiceOption[] {
  if (!Array.isArray(value)) return [];
  const out: ServiceOption[] = [];
  for (const o of value) {
    if (!o || typeof o !== "object") continue;
    const r = o as Record<string, unknown>;
    const label = readLocalized(r.label);
    const ok = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= MAX_UNIT_CENTS;
    if (typeof r.id !== "string" || !OPTION_ID_RE.test(r.id) || !label.fr || !ok(r.saleCents) || !ok(r.partnerCents) || r.partnerCents > r.saleCents) continue;
    out.push({ id: r.id, label, saleCents: r.saleCents, partnerCents: r.partnerCents, perUnit: r.perUnit === true });
  }
  return out;
}

// ---------- A request: final price, payment, note ----------

export interface FinalPriceInput {
  saleTotalCents: number;
  partnerTotalCents: number;
}

/** The final price of a request (a quote, or a price agreed with the guest): totals in dirhams, partner ≤ sale. */
export function parseFinalPriceForm(values: Record<string, string>): ParseResult<FinalPriceInput> {
  const errors: FieldErrors = {};
  const sale = amount(values, "saleTotal", "Prix de vente total", errors, MAX_TOTAL_CENTS);
  const partner = amount(values, "partnerTotal", "Prix partenaire total", errors, MAX_TOTAL_CENTS);
  if (sale !== null && partner !== null && partner > sale) errors.partnerTotal = "Prix partenaire : supérieur au prix de vente (marge négative)";
  if (Object.keys(errors).length || sale === null || partner === null) return { ok: false, fieldErrors: errors };
  return { ok: true, input: { saleTotalCents: sale, partnerTotalCents: partner } };
}

export function parsePaymentMethod(raw: string): ServicePaymentMethod | null {
  return (PAYMENT_METHODS as readonly string[]).includes(raw) ? (raw as ServicePaymentMethod) : null;
}

export function parseInternalNote(raw: string): { ok: true; note: string } | { ok: false; error: string } {
  const r = str("Note interne", CONCIERGE_LIMITS.internalNote).safeParse(raw);
  return r.success ? { ok: true, note: r.data } : { ok: false, error: r.error.issues[0].message };
}
