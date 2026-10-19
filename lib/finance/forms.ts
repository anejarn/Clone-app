import { dirhamsToCentimes, percentToBps } from "@/lib/money";
import { parseRate } from "./fx";
import { isMonth } from "./months";
import { MAX_PLATFORM_FEE_BPS, PLATFORM_SOURCES, type PlatformSource } from "./platform-fees";

/**
 * The small forms of Finances (Lot 6), checked the same way on the server whatever the browser sent: a booking split's
 * inputs, the organization's finance settings, a home's financial terms, a manual adjustment. Amounts in dirhams with
 * at most two decimals (lib/money.ts), rates in percent, exchange rates with up to six decimals (lib/finance/fx.ts).
 */

export type FieldErrors = Record<string, string>;
type Parsed<T> = { ok: true; value: T } | { ok: false; fieldErrors: FieldErrors };

export function formValues(form: FormData, keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = form.get(k);
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
/** 10 000 000 MAD. */
const MAX_CENTS = 1_000_000_000;

function optionalAmount(raw: string | undefined, field: string, e: FieldErrors): number | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const c = dirhamsToCentimes(s);
  if (c === null || c > MAX_CENTS) {
    e[field] = "Montant en dirhams, deux décimales au plus (ex. 1250 ou 1250,50).";
    return null;
  }
  return c;
}

export const SPLIT_INPUT_KEYS = ["gross", "platformFee", "fxRate", "note"] as const;

export interface SplitInputValues {
  grossCents: number | null;
  platformFeeCents: number | null;
  fxRateMicros: number | null;
  note: string;
}

export function parseSplitInputs(v: Record<string, string | undefined>): Parsed<SplitInputValues> {
  const e: FieldErrors = {};
  const grossCents = optionalAmount(v.gross, "gross", e);
  const platformFeeCents = optionalAmount(v.platformFee, "platformFee", e);
  let fxRateMicros: number | null = null;
  const rate = (v.fxRate ?? "").trim();
  if (rate) {
    fxRateMicros = parseRate(rate);
    if (fxRateMicros === null) e.fxRate = "Taux en MAD pour 1 unité de la devise, six décimales au plus (ex. 10,85).";
  }
  const note = (v.note ?? "").trim();
  if (note.length > 500) e.note = "500 caractères au plus.";
  else if (CONTROL_RE.test(note)) e.note = "Caractères non autorisés.";
  if (grossCents !== null && platformFeeCents !== null && platformFeeCents > grossCents) e.platformFee = "Les frais ne peuvent pas dépasser le revenu brut.";
  if (Object.keys(e).length) return { ok: false, fieldErrors: e };
  return { ok: true, value: { grossCents, platformFeeCents, fxRateMicros, note } };
}

export const SETTINGS_KEYS = ["cleaningBeneficiary", "commissionBase", "allocation", ...PLATFORM_SOURCES.map((p) => `fee_${p}`)] as const;

export interface SettingsValues {
  cleaningBeneficiary: "SIGMA" | "OWNER";
  commissionBase: "NET_EXCL_CLEANING" | "GROSS_EXCL_CLEANING";
  allocation: "NIGHTS" | "CHECKOUT";
  platformFeeBps: Record<PlatformSource, number>;
}

export function parseSettings(v: Record<string, string | undefined>): Parsed<SettingsValues> {
  const e: FieldErrors = {};
  const cleaningBeneficiary = v.cleaningBeneficiary as SettingsValues["cleaningBeneficiary"];
  if (cleaningBeneficiary !== "SIGMA" && cleaningBeneficiary !== "OWNER") e.cleaningBeneficiary = "Choisissez qui garde les frais de ménage.";
  const commissionBase = v.commissionBase as SettingsValues["commissionBase"];
  if (commissionBase !== "NET_EXCL_CLEANING" && commissionBase !== "GROSS_EXCL_CLEANING") e.commissionBase = "Choisissez la base de la commission.";
  const allocation = v.allocation as SettingsValues["allocation"];
  if (allocation !== "NIGHTS" && allocation !== "CHECKOUT") e.allocation = "Choisissez la répartition entre les mois.";
  const platformFeeBps = {} as Record<PlatformSource, number>;
  for (const p of PLATFORM_SOURCES) {
    const bps = percentToBps(v[`fee_${p}`] ?? "");
    if (bps === null || bps > MAX_PLATFORM_FEE_BPS) e[`fee_${p}`] = "Pourcentage entre 0 et 50, deux décimales au plus.";
    else platformFeeBps[p] = bps;
  }
  if (Object.keys(e).length) return { ok: false, fieldErrors: e };
  return { ok: true, value: { cleaningBeneficiary, commissionBase, allocation, platformFeeBps } };
}

export const LISTING_TERMS_KEYS = ["cleaningFeeBeneficiary", "subleaseRent", "subleaseRentFrom"] as const;

export interface ListingTermsValues {
  cleaningFeeBeneficiary: "SIGMA" | "OWNER" | null;
  subleaseRentCents: number | null;
  subleaseRentFrom: string | null;
}

const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function parseListingTerms(v: Record<string, string | undefined>): Parsed<ListingTermsValues> {
  const e: FieldErrors = {};
  const b = v.cleaningFeeBeneficiary ?? "";
  if (b !== "" && b !== "SIGMA" && b !== "OWNER") e.cleaningFeeBeneficiary = "Choix invalide.";
  const subleaseRentCents = optionalAmount(v.subleaseRent, "subleaseRent", e);
  if (subleaseRentCents !== null && subleaseRentCents > 100_000_000) e.subleaseRent = "Loyer trop élevé.";
  const from = (v.subleaseRentFrom ?? "").trim();
  if (from && (!DAY_RE.test(from) || new Date(`${from}T00:00:00Z`).toISOString().slice(0, 10) !== from)) e.subleaseRentFrom = "Date JJ/MM/AAAA attendue.";
  if (from && subleaseRentCents === null && !e.subleaseRent) e.subleaseRentFrom = "Indiquez d'abord le loyer.";
  if (Object.keys(e).length) return { ok: false, fieldErrors: e };
  return { ok: true, value: { cleaningFeeBeneficiary: b === "" ? null : (b as "SIGMA" | "OWNER"), subleaseRentCents, subleaseRentFrom: from || null } };
}

export const ADJUSTMENT_KEYS = ["listingId", "month", "direction", "amount", "reason"] as const;

export interface AdjustmentValues {
  listingId: string;
  month: string;
  amountCents: number;
  reason: string;
}

export function parseAdjustment(v: Record<string, string | undefined>): Parsed<AdjustmentValues> {
  const e: FieldErrors = {};
  const listingId = (v.listingId ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(listingId)) e.listingId = "Choisissez le bien.";
  const month = (v.month ?? "").trim();
  if (!isMonth(month)) e.month = "Mois AAAA-MM attendu.";
  const amount = dirhamsToCentimes(v.amount ?? "");
  if (amount === null || amount === 0 || amount > 100_000_000) e.amount = "Montant en dirhams, supérieur à 0.";
  const direction = v.direction;
  if (direction !== "credit" && direction !== "debit") e.direction = "En faveur ou à la charge du propriétaire ?";
  const reason = (v.reason ?? "").trim();
  if (reason.length < 2 || reason.length > 300) e.reason = "Raison de l'ajustement, 2 à 300 caractères.";
  else if (CONTROL_RE.test(reason)) e.reason = "Caractères non autorisés.";
  if (Object.keys(e).length) return { ok: false, fieldErrors: e };
  return { ok: true, value: { listingId, month, amountCents: direction === "debit" ? -amount! : amount!, reason } };
}
