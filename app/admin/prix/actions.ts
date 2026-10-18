"use server";

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { parseRuleForm, ruleFormValues, type RuleFieldErrors, type RuleValues } from "@/lib/admin/price-rule-form";
import { TAGS } from "@/lib/data/repo";
import { createPriceRule, deletePriceRule, updatePriceRule } from "@/lib/server/admin/prices";
import { requireAdminAction } from "@/lib/server/authz";
import { AppError } from "@/lib/server/errors";
import { ID_RE } from "@/lib/server/schemas";

/**
 * Prix (ADMIN only): seasons and events. Every action checks the session, the role and double authentification again
 * (requireAdminAction), and only touches the caller's organization: rule and listing ids come from the browser and
 * are looked up within it (404 otherwise). Rules and audit trail: lib/server/admin/prices.ts.
 */

export interface RuleFormState {
  error?: string;
  fieldErrors?: RuleFieldErrors;
  /** The submitted values, to refill the form after an error. */
  values?: RuleValues;
}

export interface DeleteRuleState {
  error?: string;
}

const NOT_FOUND = "Règle introuvable.";

/** Refusals and rule violations become a message for the form; anything else is a real error. */
function failure(e: unknown): { error: string } {
  if (e instanceof AppError) return { error: e.message };
  throw e;
}

/** Prices show on the public site (cached homepage rows with weekend totals): refresh them after any change. */
function changed() {
  updateTag(TAGS.listings);
}

export async function createRuleAction(_prev: RuleFormState, form: FormData): Promise<RuleFormState> {
  const access = await requireAdminAction("/admin/prix").catch(failure);
  if ("error" in access) return access;
  const values = ruleFormValues(form);
  const parsed = parseRuleForm(values);
  if (!parsed.ok) return { error: "Corrigez les champs signalés.", fieldErrors: parsed.fieldErrors, values };
  let id: string;
  try {
    ({ id } = await createPriceRule(access, parsed.input));
  } catch (e) {
    return { ...failure(e), values };
  }
  changed();
  redirect(`/admin/prix?cree=${id}`);
}

export async function updateRuleAction(ruleId: string, _prev: RuleFormState, form: FormData): Promise<RuleFormState> {
  const access = await requireAdminAction("/admin/prix").catch(failure);
  if ("error" in access) return access;
  if (typeof ruleId !== "string" || !ID_RE.test(ruleId)) return { error: NOT_FOUND };
  const values = ruleFormValues(form);
  const parsed = parseRuleForm(values);
  if (!parsed.ok) return { error: "Corrigez les champs signalés.", fieldErrors: parsed.fieldErrors, values };
  try {
    await updatePriceRule(access, ruleId, parsed.input);
  } catch (e) {
    return { ...failure(e), values };
  }
  changed();
  redirect(`/admin/prix?modifie=${ruleId}`);
}

export async function deleteRuleAction(ruleId: string, _prev: DeleteRuleState, form: FormData): Promise<DeleteRuleState> {
  const access = await requireAdminAction("/admin/prix").catch(failure);
  if ("error" in access) return access;
  if (typeof ruleId !== "string" || !ID_RE.test(ruleId)) return { error: NOT_FOUND };
  if (form.get("confirm") !== "on") return { error: "Cochez la case pour confirmer." };
  try {
    await deletePriceRule(access, ruleId);
  } catch (e) {
    return failure(e);
  }
  changed();
  redirect("/admin/prix?supprime=1");
}
