import { centimesToDirhams, dirhamsToCentimes } from "@/lib/money";

/**
 * The settings forms of the taxe de séjour (Paramètres, ADMIN), pure. A rate is typed in dirhams with at most two
 * decimals (« 12,50 ») and stored in centimes: no rounding anywhere (lib/tax/engine.ts).
 */

export const TAX_FORM_LIMITS = { maxRateCents: 100_000, minorsAge: { min: 1, max: 25 }, note: 200 };

export interface OrgRateValues {
  effectiveFrom: string;
  rateCents: number;
  minorsExemptUnder: number | null;
  residentsExempt: boolean;
  note: string;
}

export interface ListingRateValues {
  listingId: string;
  effectiveFrom: string;
  rateCents: number | null;
  note: string;
}

export type FieldErrors = Record<string, string>;
type Parsed<T> = { ok: true; input: T } | { ok: false; fieldErrors: FieldErrors };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s: string) => DATE_RE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function rate(v: string, e: FieldErrors, required: boolean): number | null {
  if (!v.trim()) {
    if (required) e.rate = "Obligatoire.";
    return null;
  }
  const c = dirhamsToCentimes(v);
  if (c === null) e.rate = "Un montant en dirhams, deux décimales au plus (ex. 12,50).";
  else if (c > TAX_FORM_LIMITS.maxRateCents) e.rate = `${centimesToDirhams(TAX_FORM_LIMITS.maxRateCents)} MAD au maximum.`;
  return c;
}

function common(values: Record<string, string>, e: FieldErrors) {
  const effectiveFrom = (values.effectiveFrom ?? "").trim();
  if (!validDate(effectiveFrom)) e.effectiveFrom = "Date invalide.";
  const note = (values.note ?? "").trim();
  if (note.length > TAX_FORM_LIMITS.note) e.note = `${TAX_FORM_LIMITS.note} caractères au maximum.`;
  else if (CONTROL.test(note)) e.note = "Caractères non autorisés.";
  return { effectiveFrom, note };
}

export function parseOrgRateForm(values: Record<string, string>): Parsed<OrgRateValues> {
  const e: FieldErrors = {};
  const { effectiveFrom, note } = common(values, e);
  const rateCents = rate(values.rate ?? "", e, true);
  const exemptMinors = values.minorsExempt === "on";
  let minorsExemptUnder: number | null = null;
  if (exemptMinors) {
    const a = Number((values.minorsAge ?? "").trim());
    if (!Number.isInteger(a) || a < TAX_FORM_LIMITS.minorsAge.min || a > TAX_FORM_LIMITS.minorsAge.max) e.minorsAge = `Un âge entre ${TAX_FORM_LIMITS.minorsAge.min} et ${TAX_FORM_LIMITS.minorsAge.max} ans.`;
    else minorsExemptUnder = a;
  }
  if (Object.keys(e).length || rateCents === null) return { ok: false, fieldErrors: e };
  return { ok: true, input: { effectiveFrom, rateCents, minorsExemptUnder, residentsExempt: values.residentsExempt === "on", note } };
}

export function parseListingRateForm(values: Record<string, string>): Parsed<ListingRateValues> {
  const e: FieldErrors = {};
  const { effectiveFrom, note } = common(values, e);
  const listingId = (values.listingId ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(listingId)) e.listingId = "Choisissez un bien.";
  const back = values.useOrgRate === "on";
  const rateCents = back ? null : rate(values.rate ?? "", e, true);
  if (Object.keys(e).length) return { ok: false, fieldErrors: e };
  return { ok: true, input: { listingId, effectiveFrom, rateCents, note } };
}

export function parseRetentionForm(values: Record<string, string>): { ok: true; days: number } | { ok: false; fieldErrors: FieldErrors } {
  const d = Number((values.retentionDays ?? "").trim());
  if (!Number.isInteger(d) || d < 1 || d > 3650) return { ok: false, fieldErrors: { retentionDays: "Un nombre de jours entre 1 et 3650." } };
  return { ok: true, days: d };
}

/** 1 250 → "12,50 MAD": an exact amount (the tax is never rounded to the dirham). */
export function formatTaxAmount(centimes: number): string {
  const a = Math.abs(centimes);
  const whole = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${centimes < 0 ? "-" : ""}${whole},${String(a % 100).padStart(2, "0")} MAD`;
}
