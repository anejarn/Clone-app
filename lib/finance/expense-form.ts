import { dirhamsToCentimes } from "@/lib/money";

/**
 * The expense form (Finances → Dépenses, Lot 6): what an associé types, checked the same way on the server
 * (app/admin/finances/actions.ts) whatever the browser sent. Amounts TTC in dirhams (two decimals at most).
 */

export const EXPENSE_CATEGORIES = ["REPAIR", "PURCHASE", "SUPPLIES", "CLEANING", "UTILITIES", "OTHER"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export const EXPENSE_CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  REPAIR: "Réparation",
  PURCHASE: "Achat (équipement)",
  SUPPLIES: "Consommables",
  CLEANING: "Ménage / blanchisserie",
  UTILITIES: "Eau, électricité, internet",
  OTHER: "Autre",
};

export type ExpensePayer = "SIGMA" | "OWNER";
export const PAYER_LABEL: Record<ExpensePayer, string> = { SIGMA: "Payée par Sigma", OWNER: "Payée par le propriétaire" };

export type ExpenseStatus = "DRAFT" | "VALIDATED" | "REVERSED";
export const EXPENSE_STATUS_LABEL: Record<ExpenseStatus, string> = { DRAFT: "Brouillon", VALIDATED: "Validée", REVERSED: "Contre-passée" };

/** 1 000 000 MAD. */
export const MAX_EXPENSE_CENTS = 100_000_000;
export const EXPENSE_LIMITS = { description: 500, supplier: 120, reason: 500 } as const;

export interface ExpenseInput {
  listingId: string;
  /** yyyy-MM-dd, the date on the invoice / of the purchase. */
  date: string;
  category: ExpenseCategory;
  description: string;
  supplier: string;
  amountCents: number;
  paidBy: ExpensePayer;
  rebillToOwner: boolean;
  ticketId: string | null;
}

export type ExpenseFieldErrors = Partial<Record<"listingId" | "date" | "category" | "description" | "supplier" | "amount" | "paidBy" | "ticketId", string>>;

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function validDay(s: string): boolean {
  if (!DAY_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function expenseFormValues(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ["listingId", "date", "category", "description", "supplier", "amount", "paidBy", "rebillToOwner", "ticketId"]) {
    const v = form.get(k);
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

export function parseExpense(v: Record<string, string | undefined>, opts: { today: string }): { ok: true; input: ExpenseInput } | { ok: false; fieldErrors: ExpenseFieldErrors } {
  const e: ExpenseFieldErrors = {};
  const listingId = (v.listingId ?? "").trim();
  if (!ID_RE.test(listingId)) e.listingId = "Choisissez le bien.";
  const date = (v.date ?? "").trim();
  if (!validDay(date)) e.date = "Date JJ/MM/AAAA attendue.";
  else if (date > opts.today) e.date = "La date ne peut pas être dans le futur.";
  else if (date < "2020-01-01") e.date = "Date trop ancienne.";
  const category = (v.category ?? "") as ExpenseCategory;
  if (!EXPENSE_CATEGORIES.includes(category)) e.category = "Choisissez une catégorie.";
  const description = (v.description ?? "").trim();
  if (description.length < 2) e.description = "Décrivez la dépense (2 caractères au moins).";
  else if (description.length > EXPENSE_LIMITS.description) e.description = `${EXPENSE_LIMITS.description} caractères au plus.`;
  else if (CONTROL_RE.test(description)) e.description = "Caractères non autorisés.";
  const supplier = (v.supplier ?? "").trim();
  if (supplier.length > EXPENSE_LIMITS.supplier) e.supplier = `${EXPENSE_LIMITS.supplier} caractères au plus.`;
  else if (CONTROL_RE.test(supplier)) e.supplier = "Caractères non autorisés.";
  const amountCents = dirhamsToCentimes(v.amount ?? "");
  if (amountCents === null || amountCents <= 0) e.amount = "Montant TTC en dirhams, supérieur à 0 (ex. 350 ou 349,90).";
  else if (amountCents > MAX_EXPENSE_CENTS) e.amount = "Montant trop élevé.";
  const paidBy = v.paidBy as ExpensePayer;
  if (paidBy !== "SIGMA" && paidBy !== "OWNER") e.paidBy = "Qui a payé ?";
  const ticketRaw = (v.ticketId ?? "").trim();
  if (ticketRaw && !ID_RE.test(ticketRaw)) e.ticketId = "Panne introuvable.";
  if (Object.keys(e).length) return { ok: false, fieldErrors: e };
  return {
    ok: true,
    input: { listingId, date, category, description, supplier, amountCents: amountCents!, paidBy, rebillToOwner: v.rebillToOwner === "on" || v.rebillToOwner === "true", ticketId: ticketRaw || null },
  };
}
