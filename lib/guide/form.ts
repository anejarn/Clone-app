import { z } from "zod";
import { whatsappNumber } from "@/lib/admin/users";
import type { GuideAccessCodeKind, GuideRecommendationCategory } from "@/lib/generated/prisma/enums";
import { GUEST_LOCALES } from "@/lib/i18n/locales";
import type { Localized } from "@/lib/i18n/localized";
import { CONTROL_RE } from "@/lib/server/schemas";

/**
 * The back-office forms of the welcome guide (Biens → Guide d'accueil, and the organization's common settings),
 * validated on the server by app/admin/biens/[id]/guide/actions.ts and app/admin/biens/guide-commun/actions.ts.
 * Pure: labels, limits, parsing. Texts in several languages come as `<field>_fr`, `<field>_es`, `<field>_en`.
 */

export const ACCESS_CODE_KIND_LABEL: Record<GuideAccessCodeKind, string> = {
  DOOR: "Porte d'entrée",
  KEYBOX: "Boîte à clés",
  ALARM: "Alarme",
  GATE: "Portail",
  PARKING: "Parking",
  OTHER: "Autre code",
};
export const ACCESS_CODE_KINDS = Object.keys(ACCESS_CODE_KIND_LABEL) as [GuideAccessCodeKind, ...GuideAccessCodeKind[]];

export const RECOMMENDATION_CATEGORY_LABEL: Record<GuideRecommendationCategory, string> = {
  RESTAURANT: "Restaurant",
  CAFE: "Café",
  HAMMAM: "Hammam, spa",
  SOUK: "Souk",
  CULTURE: "Culture",
  NATURE: "Nature, jardin",
  SHOPPING: "Boutique",
  OTHER: "Autre",
};
export const RECOMMENDATION_CATEGORIES = Object.keys(RECOMMENDATION_CATEGORY_LABEL) as [GuideRecommendationCategory, ...GuideRecommendationCategory[]];

export const GUIDE_LIMITS = {
  text: 4000,
  mapsUrl: 500,
  wifiName: 100,
  wifiPassword: 100,
  codeLabel: 80,
  codeValue: 100,
  codesPerListing: 12,
  recoName: 120,
  recoText: 600,
  recoUrl: 500,
  recosPerScope: 40,
  photoCaption: 200,
  photosPerListing: 8,
} as const;

export type GuideFieldErrors = Record<string, string>;
export type ParseResult<T> = { ok: true; input: T } | { ok: false; fieldErrors: GuideFieldErrors };

function errorsOf(error: z.ZodError): GuideFieldErrors {
  const out: GuideFieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}

function parse<T>(schema: z.ZodType<T>, values: Record<string, unknown>): ParseResult<T> {
  const r = schema.safeParse(values);
  return r.success ? { ok: true, input: r.data } : { ok: false, fieldErrors: errorsOf(r.error) };
}

const str = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} : ${max} caractères au maximum`)
    .refine((s) => !CONTROL_RE.test(s), `${label} : caractères non autorisés`);

const optionalUrl = (label: string, max: number, https = false) =>
  str(label, max).refine((s) => s === "" || (https ? /^https:\/\/\S+$/ : /^https?:\/\/\S+$/).test(s), `${label} : adresse ${https ? "https://" : "http(s)://"} attendue`);

/** Values of a FormData as strings (files and repeated keys ignored); checkboxes are "on" when ticked. */
export function formValues(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string" && !(k in out)) out[k] = v;
  return out;
}

/** `<field>_fr` / `_es` / `_en` → { fr, es, en } without the blank ones. */
function localizedFrom(values: Record<string, string>, field: string): Localized {
  const out: Localized = {};
  for (const l of GUEST_LOCALES) {
    const v = (values[`${field}_${l}`] ?? "").trim();
    if (v) out[l] = v;
  }
  return out;
}

/** Checks each `<field>_<locale>` against `max`, collecting errors under that key. */
function checkLocalized(values: Record<string, string>, field: string, label: string, max: number, errors: GuideFieldErrors): Localized {
  for (const l of GUEST_LOCALES) {
    const key = `${field}_${l}`;
    const r = str(`${label} (${l})`, max).safeParse(values[key] ?? "");
    if (!r.success) errors[key] ??= r.error.issues[0].message;
  }
  return localizedFrom(values, field);
}

// ---------- Texts ----------

export interface GuideTextsInput {
  mapsUrl: string | null;
  directions: Localized;
  accessInstructions: Localized;
  /** The house rules in the other languages; French stays the listing's houseRules (Biens). */
  houseRulesTranslations: Localized;
  useOrgRecommendations: boolean;
}

export function parseGuideTexts(values: Record<string, string>): ParseResult<GuideTextsInput> {
  const errors: GuideFieldErrors = {};
  const maps = optionalUrl("Lien de l'itinéraire", GUIDE_LIMITS.mapsUrl, true).safeParse(values.mapsUrl ?? "");
  if (!maps.success) errors.mapsUrl = maps.error.issues[0].message;
  const directions = checkLocalized(values, "directions", "Itinéraire", GUIDE_LIMITS.text, errors);
  const accessInstructions = checkLocalized(values, "access", "Instructions d'accès", GUIDE_LIMITS.text, errors);
  const rules = checkLocalized(values, "rules", "Règles de la maison", GUIDE_LIMITS.text, errors);
  if (Object.keys(errors).length) return { ok: false, fieldErrors: errors };
  // French house rules are edited in Biens (listings.houseRules); only the other languages are kept here.
  const { fr: _fr, ...houseRulesTranslations } = rules;
  void _fr;
  return {
    ok: true,
    input: {
      mapsUrl: maps.success && maps.data ? maps.data : null,
      directions,
      accessInstructions,
      houseRulesTranslations,
      useOrgRecommendations: values.useOrgRecommendations === "on",
    },
  };
}

// ---------- Wi-Fi ----------

export interface WifiInput {
  wifiName: string | null;
  /** undefined = keep the stored password, null = remove it. */
  wifiPassword: string | null | undefined;
}

export function parseWifi(values: Record<string, string>): ParseResult<WifiInput> {
  const schema = z.object({
    wifiName: str("Nom du réseau", GUIDE_LIMITS.wifiName),
    wifiPassword: z
      .string()
      .max(GUIDE_LIMITS.wifiPassword, `Mot de passe : ${GUIDE_LIMITS.wifiPassword} caractères au maximum`)
      .refine((s) => !CONTROL_RE.test(s), "Mot de passe : caractères non autorisés"),
  });
  const r = parse(schema, { wifiName: values.wifiName ?? "", wifiPassword: values.wifiPassword ?? "" });
  if (!r.ok) return r;
  const clear = values.clearWifiPassword === "on";
  const password = r.input.wifiPassword.trim() ? r.input.wifiPassword : undefined;
  if (clear && password) return { ok: false, fieldErrors: { wifiPassword: "Saisissez un mot de passe ou cochez « Supprimer », pas les deux." } };
  return { ok: true, input: { wifiName: r.input.wifiName || null, wifiPassword: clear ? null : password } };
}

// ---------- Access codes ----------

export interface AccessCodeInput {
  kind: GuideAccessCodeKind;
  label: string;
  /** undefined (editing) = keep the stored value. */
  value: string | undefined;
}

export function parseAccessCode(values: Record<string, string>, { requireValue }: { requireValue: boolean }): ParseResult<AccessCodeInput> {
  const schema = z.object({
    kind: z.enum(ACCESS_CODE_KINDS, { message: "Type de code : choisissez dans la liste" }),
    label: str("Précision", GUIDE_LIMITS.codeLabel),
    value: str("Code", GUIDE_LIMITS.codeValue),
  });
  const r = parse(schema, { kind: values.kind ?? "", label: values.label ?? "", value: values.value ?? "" });
  if (!r.ok) return r;
  if (requireValue && !r.input.value) return { ok: false, fieldErrors: { value: "Code : champ obligatoire" } };
  return { ok: true, input: { kind: r.input.kind, label: r.input.label, value: r.input.value || undefined } };
}

// ---------- Recommendations ----------

export interface RecommendationInput {
  category: GuideRecommendationCategory;
  name: string;
  description: Localized;
  url: string | null;
}

export function parseRecommendation(values: Record<string, string>): ParseResult<RecommendationInput> {
  const errors: GuideFieldErrors = {};
  const r = parse(
    z.object({
      category: z.enum(RECOMMENDATION_CATEGORIES, { message: "Catégorie : choisissez dans la liste" }),
      name: str("Nom", GUIDE_LIMITS.recoName).refine((s) => s.length > 0, "Nom : champ obligatoire"),
      url: optionalUrl("Lien", GUIDE_LIMITS.recoUrl),
    }),
    { category: values.category ?? "", name: values.name ?? "", url: values.url ?? "" },
  );
  if (!r.ok) Object.assign(errors, r.fieldErrors);
  const description = checkLocalized(values, "description", "Description", GUIDE_LIMITS.recoText, errors);
  if (!r.ok || Object.keys(errors).length) return { ok: false, fieldErrors: errors };
  return { ok: true, input: { category: r.input.category, name: r.input.name, description, url: r.input.url || null } };
}

// ---------- Organization settings ----------

export interface ConciergeInput {
  conciergePhone: string | null;
  conciergeWhatsapp: string | null;
}

/** "+212 6 12 34 56 78", "0612345678" → "+212612345678"; null when it isn't a phone number. */
export function normalizePhone(s: string): string | null {
  const n = whatsappNumber(s);
  return n ? `+${n}` : null;
}

export function parseConcierge(values: Record<string, string>): ParseResult<ConciergeInput> {
  const errors: GuideFieldErrors = {};
  const out: ConciergeInput = { conciergePhone: null, conciergeWhatsapp: null };
  for (const [key, label] of [
    ["conciergePhone", "Téléphone"],
    ["conciergeWhatsapp", "WhatsApp"],
  ] as const) {
    const raw = (values[key] ?? "").trim();
    if (!raw) continue;
    const n = raw.length <= 30 ? normalizePhone(raw) : null;
    if (!n) errors[key] = `${label} : numéro au format international attendu (ex. +212 6 12 34 56 78)`;
    else out[key] = n;
  }
  return Object.keys(errors).length ? { ok: false, fieldErrors: errors } : { ok: true, input: out };
}

/** The guide's default maps link when none is typed: the home's coordinates. */
export function defaultMapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/** Text with one item per line (house rules) as a list, blank lines dropped. */
export function lines(text: string | null | undefined): string[] {
  return (text ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean);
}

