import { z } from "zod";
import { formatDate, formatPrice, pluralize } from "@/lib/format";
import { centimesToDirhams, dirhamsToCentimes } from "@/lib/money";
import { PERCENT_BPS_MAX, PERCENT_BPS_MIN, type PriceAdjustment, type PriceRuleKind } from "@/lib/pricing";
import { CONTROL_RE, ID_RE } from "@/lib/server/schemas";
import { daysBetween, parseDay } from "./calendar";

/**
 * Seasons and events typed by an associé (Prix), validated on the server by app/admin/prix/actions.ts; rules that need
 * the database (the listings are homes of the organization) are in lib/server/admin/prices.ts. The same bounds are
 * database checks (migration 20261024090000_price_rules). Amounts are typed in dirhams and stored in centimes,
 * percentages typed with their sign ("+20", "-10", "12,5") and stored in basis points. Unit-tested.
 */

export const RULE_KINDS = ["SEASON", "EVENT"] as const satisfies readonly PriceRuleKind[];
export const RULE_KIND_LABEL: Record<PriceRuleKind, string> = { SEASON: "Saison", EVENT: "Événement" };

export const ADJUSTMENT_TYPES = ["PERCENT", "FIXED"] as const;
export type AdjustmentType = (typeof ADJUSTMENT_TYPES)[number];
export const ADJUSTMENT_TYPE_LABEL: Record<AdjustmentType, string> = {
  PERCENT: "Pourcentage du prix de base",
  FIXED: "Prix fixe par nuit (un seul bien)",
};

export const SCOPES = ["ALL", "SELECTED"] as const;
export type RuleScopeKind = (typeof SCOPES)[number];

export const RULE_LIMITS = {
  name: 80,
  /** A one-off rule covers at most two years of nights. */
  maxSpanDays: 730,
  /** A yearly rule is shorter than a year (price_rules_recurring_span_check). */
  maxRecurringSpanDays: 364,
  minNights: 365,
  priority: 100,
  listings: 500,
  /** 10 000 000 MAD, in centimes. */
  maxFixedCents: 1_000_000_000,
  minFixedCents: 100,
} as const;

export const RULE_FIELDS = [
  "kind",
  "name",
  "startDate",
  "endDate",
  "recurring",
  "adjustmentType",
  "percent",
  "fixed",
  "minNights",
  "priority",
  "scope",
  "listingIds",
] as const;
export type RuleFieldName = (typeof RULE_FIELDS)[number];
export type RuleFieldErrors = Partial<Record<RuleFieldName, string>>;
/** Raw form values: strings, and the list of listing ids. */
export type RuleValues = Partial<Record<Exclude<RuleFieldName, "listingIds">, string>> & { listingIds?: string[] };

export interface PriceRuleInput {
  kind: PriceRuleKind;
  name: string;
  startDate: Date;
  endDate: Date;
  recurring: boolean;
  adjustment: PriceAdjustment;
  minNights: number | null;
  priority: number;
  allListings: boolean;
  /** Empty when allListings. Distinct, in the order typed. */
  listingIds: string[];
}

const PERCENT_RE = /^([+\-−]?)(\d{1,3})(?:[.,](\d{1,2}))?%?$/;

/** "+20" → 2 000, "-10" / "−10" → −1 000, "12,5" → 1 250, "0" → 0; null when it isn't a percentage. */
export function signedPercentToBps(input: string): number | null {
  const m = PERCENT_RE.exec(input.trim().replace(/[\s  ]/g, ""));
  if (!m) return null;
  const abs = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0"));
  return m[1] === "-" || m[1] === "−" ? -abs : abs;
}

/** 2 000 → "+20", −1 250 → "-12,5", 0 → "0": back to the form field. */
export function bpsToSignedPercent(bps: number): string {
  const abs = Math.abs(bps);
  const whole = Math.floor(abs / 100);
  const rest = abs % 100;
  const text = rest === 0 ? String(whole) : `${whole},${String(rest).padStart(2, "0").replace(/0$/, "")}`;
  return bps > 0 ? `+${text}` : bps < 0 ? `-${text}` : text;
}

/** "+20 %", "−10 %", "1 500 MAD la nuit", "Prix inchangé" (a rule that only sets a minimum stay). */
export function adjustmentLabel(a: PriceAdjustment): string {
  if (a.type === "FIXED") return `${formatPrice(a.cents)} la nuit`;
  if (a.bps === 0) return "Prix inchangé";
  return `${bpsToSignedPercent(a.bps).replace("-", "−")} %`;
}

const dayMonth = (d: Date) => formatDate(d).slice(0, 5);

/** "du 23/01/2027 au 25/01/2027", or "chaque année du 20/12 au 04/01" for a yearly rule. Both nights included. */
export function ruleDatesLabel(r: { startDate: Date; endDate: Date; recurring: boolean }): string {
  if (r.recurring) return `chaque année du ${dayMonth(r.startDate)} au ${dayMonth(r.endDate)}`;
  return `du ${formatDate(r.startDate)} au ${formatDate(r.endDate)}`;
}

/** "Tous les biens", "Riad Dar Zitoun", "3 biens". */
export function ruleScopeLabel(r: { allListings: boolean; listings: { title: string }[] }): string {
  if (r.allListings) return "Tous les biens";
  if (r.listings.length === 1) return r.listings[0].title;
  return r.listings.length === 0 ? "Aucun bien" : pluralize(r.listings.length, "bien", "biens");
}

// ---------- Form ----------

const required = (label: string) => `${label} : champ obligatoire`;

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

const optionalInt = (label: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .refine((s) => s === "" || /^\d{1,3}$/.test(s), `${label} : nombre entier attendu`)
    .transform((s) => (s === "" ? null : Number(s)))
    .refine((n) => n === null || (n >= min && n <= max), `${label} : entre ${min} et ${max}`);

const schema = z
  .object({
    kind: z.enum(RULE_KINDS, { message: "Type : choisissez saison ou événement" }),
    name: z
      .string()
      .trim()
      .min(2, required("Nom"))
      .max(RULE_LIMITS.name, `Nom : ${RULE_LIMITS.name} caractères au maximum`)
      .refine((s) => !CONTROL_RE.test(s), "Nom : caractères non autorisés"),
    startDate: dateField("Première nuit"),
    endDate: dateField("Dernière nuit"),
    recurring: z
      .string()
      .optional()
      .transform((v) => v === "on" || v === "true"),
    adjustmentType: z.enum(ADJUSTMENT_TYPES, { message: "Ajustement : choisissez dans la liste" }),
    percent: z.string().trim(),
    fixed: z.string().trim(),
    minNights: optionalInt("Séjour minimum", 1, RULE_LIMITS.minNights),
    priority: optionalInt("Priorité", 0, RULE_LIMITS.priority).transform((n) => n ?? 0),
    scope: z.enum(SCOPES, { message: "Biens concernés : choisissez dans la liste" }),
    listingIds: z
      .array(z.string().trim())
      .max(RULE_LIMITS.listings, `Biens concernés : ${RULE_LIMITS.listings} au maximum`)
      .refine((ids) => ids.every((id) => ID_RE.test(id)), "Biens concernés : choisissez dans la liste")
      .transform((ids) => [...new Set(ids)]),
  })
  .transform((v, ctx): PriceRuleInput => {
    const issue = (path: RuleFieldName, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    const span = daysBetween(v.startDate, v.endDate);
    if (span < 0) issue("endDate", "Dernière nuit : le même jour que la première nuit ou après");
    else if (v.recurring && span > RULE_LIMITS.maxRecurringSpanDays) issue("endDate", "Dernière nuit : une règle annuelle dure moins d'un an");
    else if (span > RULE_LIMITS.maxSpanDays) issue("endDate", "Dernière nuit : deux ans au maximum après la première nuit");

    let adjustment: PriceAdjustment = { type: "PERCENT", bps: 0 };
    if (v.adjustmentType === "PERCENT") {
      const bps = v.percent === "" ? null : signedPercentToBps(v.percent);
      if (bps === null) issue("percent", "Pourcentage : nombre attendu, avec son signe (ex. +20 ou -10)");
      else if (bps < PERCENT_BPS_MIN || bps > PERCENT_BPS_MAX) issue("percent", "Pourcentage : entre -90 et +500");
      else adjustment = { type: "PERCENT", bps };
    } else {
      const cents = v.fixed === "" ? null : dirhamsToCentimes(v.fixed);
      if (cents === null) issue("fixed", "Prix par nuit : montant en dirhams attendu (ex. 1500 ou 1500,50)");
      else if (cents < RULE_LIMITS.minFixedCents) issue("fixed", "Prix par nuit : 1 MAD au minimum");
      else if (cents > RULE_LIMITS.maxFixedCents) issue("fixed", "Prix par nuit : montant trop élevé");
      else adjustment = { type: "FIXED", cents };
    }
    if (adjustment.type === "PERCENT" && adjustment.bps === 0 && v.minNights === null && !ctx.issues.some((i) => i.path?.[0] === "percent")) {
      issue("percent", "Pourcentage : indiquez un ajustement, ou un séjour minimum pour une règle sans changement de prix");
    }

    const allListings = v.scope === "ALL";
    if (!allListings && v.listingIds.length === 0) issue("listingIds", "Biens concernés : cochez au moins un bien");
    if (v.adjustmentType === "FIXED" && (allListings || v.listingIds.length !== 1)) {
      issue("listingIds", "Biens concernés : un prix fixe s'applique à un seul bien (utilisez un pourcentage pour plusieurs biens)");
    }
    return {
      kind: v.kind,
      name: v.name,
      startDate: v.startDate,
      endDate: v.endDate,
      recurring: v.recurring,
      adjustment,
      minNights: v.minNights,
      priority: v.priority,
      allListings,
      listingIds: allListings ? [] : v.listingIds,
    };
  });

/** The raw values of the form (strings, the checked listings); anything else in the FormData is ignored. */
export function ruleFormValues(form: FormData): RuleValues {
  const values: RuleValues = {};
  for (const k of RULE_FIELDS) {
    if (k === "listingIds") values.listingIds = form.getAll("listingIds").filter((x): x is string => typeof x === "string");
    else {
      const x = form.get(k);
      values[k] = typeof x === "string" ? x : "";
    }
  }
  return values;
}

export type ParsedRule = { ok: true; input: PriceRuleInput } | { ok: false; fieldErrors: RuleFieldErrors };

export function parseRuleForm(values: RuleValues): ParsedRule {
  const v = {
    ...Object.fromEntries(RULE_FIELDS.filter((k) => k !== "listingIds").map((k) => [k, values[k as Exclude<RuleFieldName, "listingIds">] ?? ""])),
    recurring: values.recurring || undefined,
    listingIds: values.listingIds ?? [],
  };
  const parsed = schema.safeParse(v);
  if (parsed.success) return { ok: true, input: parsed.data };
  const fieldErrors: RuleFieldErrors = {};
  for (const issue of parsed.error.issues) {
    const key = (issue.path[0] ?? "name") as RuleFieldName;
    fieldErrors[key] ??= issue.message.includes(" : ") ? issue.message : `${key} : valeur invalide`;
  }
  return { ok: false, fieldErrors };
}

/** A stored rule back to the form's values. */
export function ruleToValues(r: {
  kind: PriceRuleKind;
  name: string;
  startDate: Date;
  endDate: Date;
  recurring: boolean;
  adjustmentType: AdjustmentType;
  percentBps: number | null;
  fixedCents: number | null;
  minNights: number | null;
  priority: number;
  allListings: boolean;
  listingIds: string[];
}): RuleValues {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return {
    kind: r.kind,
    name: r.name,
    startDate: iso(r.startDate),
    endDate: iso(r.endDate),
    recurring: r.recurring ? "on" : "",
    adjustmentType: r.adjustmentType,
    percent: r.percentBps === null ? "" : bpsToSignedPercent(r.percentBps),
    fixed: r.fixedCents === null ? "" : centimesToDirhams(r.fixedCents),
    minNights: r.minNights === null ? "" : String(r.minNights),
    priority: String(r.priority),
    scope: r.allListings ? "ALL" : "SELECTED",
    listingIds: r.listingIds,
  };
}

export const EMPTY_RULE_VALUES: RuleValues = {
  kind: "SEASON",
  name: "",
  startDate: "",
  endDate: "",
  recurring: "",
  adjustmentType: "PERCENT",
  percent: "",
  fixed: "",
  minNights: "",
  priority: "0",
  scope: "ALL",
  listingIds: [],
};
