"use server";

import { refresh } from "next/cache";
import { SETTINGS_PATH } from "@/lib/admin/sections";
import { requireAdminAction } from "@/lib/server/authz";
import { addListingTaxRate, addOrgTaxRate, deleteTaxRate, updateIdentityRetention } from "@/lib/server/declarations/tax";
import { AppError } from "@/lib/server/errors";
import { ID_RE } from "@/lib/server/schemas";
import { parseListingRateForm, parseOrgRateForm, parseRetentionForm, type FieldErrors } from "@/lib/tax/form";

/**
 * Paramètres (ADMIN): taxe de séjour rates and exemptions (organization versions, home overrides) and the retention of
 * the travellers' identity data. Every action checks the session, the role and double authentification again
 * (requireAdminAction("/admin/parametres")); rules and audit: lib/server/declarations/tax.ts.
 */

export interface SettingsFormState {
  error?: string;
  message?: string;
  fieldErrors?: FieldErrors;
  values?: Record<string, string>;
  saved?: number;
}

function failure(e: unknown): { error: string } {
  if (e instanceof AppError) return { error: e.message };
  throw e;
}

const valuesOf = (form: FormData) => Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string").map(([k, v]) => [k, String(v).trim()]));
const invalid = (fieldErrors: FieldErrors, values: Record<string, string>): SettingsFormState => ({ error: "Corrigez les champs signalés.", fieldErrors, values });

export async function addOrgRateAction(prev: SettingsFormState, form: FormData): Promise<SettingsFormState> {
  const access = await requireAdminAction(SETTINGS_PATH).catch(failure);
  if ("error" in access) return access;
  const values = valuesOf(form);
  const parsed = parseOrgRateForm(values);
  if (!parsed.ok) return invalid(parsed.fieldErrors, values);
  try {
    await addOrgTaxRate(access, parsed.input);
  } catch (e) {
    return { ...failure(e), values };
  }
  refresh();
  return { message: "Taux enregistré.", saved: (prev.saved ?? 0) + 1 };
}

export async function addListingRateAction(prev: SettingsFormState, form: FormData): Promise<SettingsFormState> {
  const access = await requireAdminAction(SETTINGS_PATH).catch(failure);
  if ("error" in access) return access;
  const values = valuesOf(form);
  const parsed = parseListingRateForm(values);
  if (!parsed.ok) return invalid(parsed.fieldErrors, values);
  try {
    await addListingTaxRate(access, parsed.input);
  } catch (e) {
    return { ...failure(e), values };
  }
  refresh();
  return { message: "Taux du bien enregistré.", saved: (prev.saved ?? 0) + 1 };
}

export async function deleteRateAction(kind: "org" | "listing", id: string): Promise<{ error?: string; message?: string }> {
  const access = await requireAdminAction(SETTINGS_PATH).catch(failure);
  if ("error" in access) return access;
  if ((kind !== "org" && kind !== "listing") || typeof id !== "string" || !ID_RE.test(id)) return { error: "Taux introuvable." };
  try {
    await deleteTaxRate(access, kind, id);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { message: "Taux supprimé." };
}

export async function saveRetentionAction(_prev: SettingsFormState, form: FormData): Promise<SettingsFormState> {
  const access = await requireAdminAction(SETTINGS_PATH).catch(failure);
  if ("error" in access) return access;
  const values = valuesOf(form);
  const parsed = parseRetentionForm(values);
  if (!parsed.ok) return invalid(parsed.fieldErrors, values);
  try {
    await updateIdentityRetention(access, parsed.days);
  } catch (e) {
    return { ...failure(e), values };
  }
  refresh();
  return { message: "Durée de conservation enregistrée." };
}
