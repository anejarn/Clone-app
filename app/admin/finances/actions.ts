"use server";

import { refresh } from "next/cache";
import { FINANCES_PATH } from "@/lib/admin/sections";
import { todayInTimeZone } from "@/lib/dates";
import { expenseFormValues, parseExpense, type ExpenseFieldErrors } from "@/lib/finance/expense-form";
import { ADJUSTMENT_KEYS, formValues, LISTING_TERMS_KEYS, parseAdjustment, parseListingTerms, parseSettings, parseSplitInputs, SETTINGS_KEYS, SPLIT_INPUT_KEYS, type FieldErrors } from "@/lib/finance/forms";
import { FINANCE_TIMEZONE, isMonth, monthShort } from "@/lib/finance/months";
import { requireAdminAction } from "@/lib/server/authz";
import { AppError } from "@/lib/server/errors";
import { reapplyBookingTerms, setBookingFinanceInputs } from "@/lib/server/finance/bookings";
import { attachReceipt, createExpense, deleteExpense, MAX_RECEIPT_BYTES, reverseExpense, updateExpense, validateExpense } from "@/lib/server/finance/expenses";
import { addManualAdjustment, closeMonth, reopenMonth, saveFinanceSettings, saveListingTerms } from "@/lib/server/finance/ledger";
import { generateMonthStatements, generateStatement, MAX_LOGO_BYTES, recordOwnerPayout, reverseOwnerPayout, saveStatementBranding } from "@/lib/server/finance/statements";
import { parseRate } from "@/lib/finance/fx";
import { dirhamsToCentimes } from "@/lib/money";
import { ID_RE } from "@/lib/server/schemas";

/**
 * Finances (Lot 6). Every action checks the session, the role (associés: the roles of /admin/finances) and double
 * authentification again, then works only on the caller's organization (another organization's row is
 * « introuvable »). Rules, journal and audit: lib/server/finance/.
 */

export interface FinanceFormState {
  error?: string;
  message?: string;
  fieldErrors?: FieldErrors | ExpenseFieldErrors;
  values?: Record<string, string>;
  /** Bumped on success, to reset the form. */
  saved?: number;
  /** The expense created. */
  id?: string;
}

export interface SimpleResult {
  error?: string;
  message?: string;
}

const ok = (id: unknown): id is string => typeof id === "string" && ID_RE.test(id);
const today = () => todayInTimeZone(FINANCE_TIMEZONE).toISOString().slice(0, 10);

/** An AppError becomes the message shown in the form; anything else is a bug and is thrown. */
function failure(e: unknown): { error: string } {
  if (e instanceof AppError) return { error: e.message };
  throw e;
}
const errorMessage = (e: unknown) => failure(e).error;

async function receiptBytes(form: FormData): Promise<Uint8Array | null | { error: string }> {
  const file = form.get("receipt");
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > MAX_RECEIPT_BYTES) return { error: `Justificatif trop lourd : ${MAX_RECEIPT_BYTES / 1024 / 1024} Mo au maximum.` };
  return new Uint8Array(await file.arrayBuffer());
}

export async function createExpenseAction(prev: FinanceFormState, form: FormData): Promise<FinanceFormState> {
  const access = await requireAdminAction(FINANCES_PATH).catch(failure);
  if ("error" in access) return access;
  const values = expenseFormValues(form);
  const parsed = parseExpense(values, { today: today() });
  if (!parsed.ok) return { error: "Corrigez les champs signalés.", fieldErrors: parsed.fieldErrors, values };
  const receipt = await receiptBytes(form);
  if (receipt && "error" in receipt) return { ...receipt, values };
  try {
    const { id } = await createExpense(access, parsed.input, receipt);
    refresh();
    return { message: "Dépense enregistrée en brouillon : vérifiez-la puis validez-la.", saved: (prev.saved ?? 0) + 1, id };
  } catch (e) {
    return { error: errorMessage(e), values };
  }
}

export async function updateExpenseAction(id: string, prev: FinanceFormState, form: FormData): Promise<FinanceFormState> {
  const access = await requireAdminAction(FINANCES_PATH).catch(failure);
  if ("error" in access) return access;
  if (!ok(id)) return { error: "Dépense introuvable." };
  const values = expenseFormValues(form);
  const parsed = parseExpense(values, { today: today() });
  if (!parsed.ok) return { error: "Corrigez les champs signalés.", fieldErrors: parsed.fieldErrors, values };
  try {
    await updateExpense(access, id, parsed.input);
  } catch (e) {
    return { error: errorMessage(e), values };
  }
  refresh();
  return { message: "Dépense modifiée.", saved: (prev.saved ?? 0) + 1 };
}

export async function deleteExpenseAction(id: string): Promise<SimpleResult> {
  const access = await requireAdminAction(FINANCES_PATH).catch(failure);
  if ("error" in access) return access;
  if (!ok(id)) return { error: "Dépense introuvable." };
  try {
    await deleteExpense(access, id);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  refresh();
  return { message: "Brouillon supprimé." };
}

export async function uploadReceiptAction(id: string, form: FormData): Promise<SimpleResult> {
  const access = await requireAdminAction(FINANCES_PATH).catch(failure);
  if ("error" in access) return access;
  if (!ok(id)) return { error: "Dépense introuvable." };
  const bytes = await receiptBytes(form);
  if (!bytes) return { error: "Choisissez le justificatif (photo ou PDF)." };
  if ("error" in bytes) return bytes;
  try {
    await attachReceipt(access, id, bytes);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  refresh();
  return { message: "Justificatif ajouté." };
}

export async function validateExpenseAction(id: string): Promise<SimpleResult> {
  const access = await requireAdminAction(FINANCES_PATH).catch(failure);
  if ("error" in access) return access;
  if (!ok(id)) return { error: "Dépense introuvable." };
  try {
    const { period } = await validateExpense(access, id);
    refresh();
    return { message: `Dépense validée et passée au journal (${monthShort(period)}).` };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function reverseExpenseAction(id: string, reason: string): Promise<SimpleResult> {
  const access = await requireAdminAction(FINANCES_PATH).catch(failure);
  if ("error" in access) return access;
  if (!ok(id) || typeof reason !== "string") return { error: "Dépense introuvable." };
  try {
    await reverseExpense(access, id, reason);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  refresh();
  return { message: "Dépense contre-passée." };
}

export async function closeMonthAction(month: string): Promise<SimpleResult> {
  const access = await requireAdminAction(FINANCES_PATH).catch(failure);
  if ("error" in access) return access;
  if (!isMonth(month)) return { error: "Mois invalide." };
  try {
    const { rents } = await closeMonth(access, month);
    refresh();
    const closed = `${monthShort(month)} clôturé${rents ? ` (${rents} loyer${rents > 1 ? "s" : ""} de sous-location passé${rents > 1 ? "s" : ""})` : ""}`;
    // Lot 6b: the month's statements are generated at once (after the closing is committed). A failure here doesn't
    // undo the closing: « Générer les relevés » (Finances → Relevés) does it again.
    try {
      const { created } = await generateMonthStatements(access, month);
      return { message: created ? `${closed} · ${created} relevé${created > 1 ? "s" : ""} propriétaire généré${created > 1 ? "s" : ""}.` : `${closed}.` };
    } catch (e) {
      if (!(e instanceof AppError)) console.error(e);
      return { message: `${closed}. Les relevés n'ont pas pu être générés : réessayez depuis Finances → Relevés.` };
    }
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function reopenMonthAction(month: string, reason: string): Promise<SimpleResult> {
  const access = await requireAdminAction(FINANCES_PATH).catch(failure);
  if ("error" in access) return access;
  if (!isMonth(month) || typeof reason !== "string") return { error: "Mois invalide." };
  try {
    await reopenMonth(access, month, reason);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  refresh();
  return { message: `${monthShort(month)} rouvert.` };
}

export async function setSplitInputsAction(bookingId: string, prev: FinanceFormState, form: FormData): Promise<FinanceFormState> {
  const access = await requireAdminAction(FINANCES_PATH).catch(failure);
  if ("error" in access) return access;
  if (!ok(bookingId)) return { error: "Réservation introuvable." };
  const values = formValues(form, SPLIT_INPUT_KEYS);
  const parsed = parseSplitInputs(values);
  if (!parsed.ok) return { error: "Corrigez les champs signalés.", fieldErrors: parsed.fieldErrors, values };
  try {
    await setBookingFinanceInputs(access, bookingId, { ...parsed.value });
  } catch (e) {
    return { error: errorMessage(e), values };
  }
  refresh();
  return { message: "Répartition recalculée.", saved: (prev.saved ?? 0) + 1 };
}

export async function reapplyTermsAction(bookingId: string): Promise<SimpleResult> {
  const access = await requireAdminAction(FINANCES_PATH).catch(failure);
  if ("error" in access) return access;
  if (!ok(bookingId)) return { error: "Réservation introuvable." };
  try {
    await reapplyBookingTerms(access, bookingId);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  refresh();
  return { message: "Conditions du bien réappliquées." };
}

export async function saveFinanceSettingsAction(prev: FinanceFormState, form: FormData): Promise<FinanceFormState> {
  const access = await requireAdminAction(FINANCES_PATH).catch(failure);
  if ("error" in access) return access;
  const values = formValues(form, SETTINGS_KEYS);
  const parsed = parseSettings(values);
  if (!parsed.ok) return { error: "Corrigez les champs signalés.", fieldErrors: parsed.fieldErrors, values };
  try {
    await saveFinanceSettings(access, parsed.value);
  } catch (e) {
    return { error: errorMessage(e), values };
  }
  refresh();
  return { message: "Paramètres enregistrés : ils s'appliquent aux nouvelles réservations.", saved: (prev.saved ?? 0) + 1 };
}

export async function saveListingTermsAction(listingId: string, prev: FinanceFormState, form: FormData): Promise<FinanceFormState> {
  const access = await requireAdminAction(FINANCES_PATH).catch(failure);
  if ("error" in access) return access;
  if (!ok(listingId)) return { error: "Bien introuvable." };
  const values = formValues(form, LISTING_TERMS_KEYS);
  const parsed = parseListingTerms(values);
  if (!parsed.ok) return { error: "Corrigez les champs signalés.", fieldErrors: parsed.fieldErrors, values };
  try {
    await saveListingTerms(access, { listingId, ...parsed.value });
  } catch (e) {
    return { error: errorMessage(e), values };
  }
  refresh();
  return { message: "Conditions du bien enregistrées.", saved: (prev.saved ?? 0) + 1 };
}

export async function addAdjustmentAction(prev: FinanceFormState, form: FormData): Promise<FinanceFormState> {
  const access = await requireAdminAction(FINANCES_PATH).catch(failure);
  if ("error" in access) return access;
  const values = formValues(form, ADJUSTMENT_KEYS);
  const parsed = parseAdjustment(values);
  if (!parsed.ok) return { error: "Corrigez les champs signalés.", fieldErrors: parsed.fieldErrors, values };
  try {
    await addManualAdjustment(access, parsed.value);
  } catch (e) {
    return { error: errorMessage(e), values };
  }
  refresh();
  return { message: "Ajustement passé au journal.", saved: (prev.saved ?? 0) + 1 };
}

// ---------- Owner statements and transfers (Lot 6b) ----------

export async function generateStatementsAction(month: string): Promise<SimpleResult> {
  const access = await requireAdminAction(FINANCES_PATH).catch(failure);
  if ("error" in access) return access;
  if (!isMonth(month)) return { error: "Mois invalide." };
  try {
    const { created, unchanged } = await generateMonthStatements(access, month);
    refresh();
    return { message: `${created} relevé${created > 1 ? "s" : ""} généré${created > 1 ? "s" : ""}${unchanged ? `, ${unchanged} inchangé${unchanged > 1 ? "s" : ""}` : ""}.` };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

/** A new version of one owner's statement, even when its figures didn't change (e.g. a new header). */
export async function regenerateStatementAction(ownerId: string, month: string): Promise<SimpleResult> {
  const access = await requireAdminAction(FINANCES_PATH).catch(failure);
  if ("error" in access) return access;
  if (!ok(ownerId) || !isMonth(month)) return { error: "Propriétaire introuvable." };
  try {
    const r = await generateStatement(access, ownerId, month, { force: true });
    refresh();
    return { message: `Relevé ${monthShort(month)} : version ${r.version} générée.` };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

const PAYOUT_KEYS = ["paidOn", "reference", "amount"] as const;

export async function recordPayoutAction(ownerId: string, month: string, prev: FinanceFormState, form: FormData): Promise<FinanceFormState> {
  const access = await requireAdminAction(FINANCES_PATH).catch(failure);
  if ("error" in access) return access;
  const values = formValues(form, PAYOUT_KEYS);
  if (!ok(ownerId) || !isMonth(month)) return { error: "Propriétaire introuvable.", values };
  const fieldErrors: Record<string, string> = {};
  const amountCents = dirhamsToCentimes(values.amount ?? "");
  if (!amountCents) fieldErrors.amount = "Montant en dirhams, par exemple 12 500,00.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.paidOn ?? "")) fieldErrors.paidOn = "Date du virement requise.";
  if ((values.reference ?? "").trim().length < 2) fieldErrors.reference = "Référence bancaire requise.";
  if (Object.keys(fieldErrors).length) return { error: "Corrigez les champs signalés.", fieldErrors, values };
  try {
    await recordOwnerPayout(access, { ownerId, month, paidOn: values.paidOn, reference: values.reference, amountCents: amountCents! });
  } catch (e) {
    return { error: errorMessage(e), values };
  }
  refresh();
  return { message: "Virement enregistré et passé au journal.", saved: (prev.saved ?? 0) + 1 };
}

export async function reversePayoutAction(id: string, reason: string): Promise<SimpleResult> {
  const access = await requireAdminAction(FINANCES_PATH).catch(failure);
  if ("error" in access) return access;
  if (!ok(id) || typeof reason !== "string") return { error: "Virement introuvable." };
  try {
    await reverseOwnerPayout(access, id, reason);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  refresh();
  return { message: "Virement annulé (écriture inverse passée au journal)." };
}

const BRANDING_KEYS = ["legalName", "legalAddress", "ice", "rcNumber", "taxIdNumber", "eurRate", "removeLogo"] as const;

export async function saveBrandingAction(prev: FinanceFormState, form: FormData): Promise<FinanceFormState> {
  const access = await requireAdminAction(FINANCES_PATH).catch(failure);
  if ("error" in access) return access;
  const values = formValues(form, BRANDING_KEYS);
  const rateText = (values.eurRate ?? "").trim();
  const eurRateMicros = rateText ? parseRate(rateText) : null;
  if (rateText && eurRateMicros === null) return { error: "Corrigez les champs signalés.", fieldErrors: { eurRate: "Taux en dirhams pour 1 euro, par exemple 10,85." }, values };
  const file = form.get("logo");
  let logo: Uint8Array | "remove" | null = values.removeLogo === "on" ? "remove" : null;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_LOGO_BYTES) return { error: "Logo : 1 Mo au maximum.", values };
    logo = new Uint8Array(await file.arrayBuffer());
  }
  try {
    await saveStatementBranding(access, { legalName: values.legalName ?? "", legalAddress: values.legalAddress ?? "", ice: values.ice ?? "", rcNumber: values.rcNumber ?? "", taxIdNumber: values.taxIdNumber ?? "", eurRateMicros }, logo);
  } catch (e) {
    return { error: errorMessage(e), values };
  }
  refresh();
  return { message: "En-tête des relevés enregistré : il s'applique aux prochains relevés générés.", saved: (prev.saved ?? 0) + 1 };
}
