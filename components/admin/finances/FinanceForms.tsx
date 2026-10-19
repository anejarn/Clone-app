"use client";

import { Check, Lock, Paperclip, RefreshCw, Trash2, Undo2, Unlock } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useId, useState, useTransition, type ReactNode } from "react";
import {
  addAdjustmentAction,
  closeMonthAction,
  createExpenseAction,
  deleteExpenseAction,
  reapplyTermsAction,
  reopenMonthAction,
  reverseExpenseAction,
  saveFinanceSettingsAction,
  saveListingTermsAction,
  setSplitInputsAction,
  updateExpenseAction,
  uploadReceiptAction,
  validateExpenseAction,
  type FinanceFormState,
  type SimpleResult,
} from "@/app/admin/finances/actions";
import { Button } from "@/components/ui/Button";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABEL } from "@/lib/finance/expense-form";
import { ALLOCATION_LABEL, BENEFICIARY_LABEL, COMMISSION_BASE_LABEL } from "@/lib/finance/labels";
import { PLATFORM_SOURCES } from "@/lib/finance/platform-fees";

/** Finances' forms (ADMIN). The server actions check everything again (app/admin/finances/actions.ts). */

const input =
  "h-11 w-full rounded-sm border border-ink-faint bg-white px-3 text-body-l outline-none focus:border-ink focus:ring-1 focus:ring-ink aria-[invalid=true]:border-error";
const card = "rounded-lg border border-line bg-white p-4 md:p-6";
const PLATFORM_NAME: Record<(typeof PLATFORM_SOURCES)[number], string> = { AIRBNB: "Airbnb", BOOKING: "Booking.com", AGODA: "Agoda", TRIPCOM: "Trip.com", EXPEDIA: "Expedia / Vrbo", OTHER: "Autres plateformes" };

export function Notice({ state }: { state: { error?: string; message?: string } }) {
  if (state.error)
    return (
      <p role="alert" className="rounded-sm border border-error bg-[#fdecea] p-3 text-error">
        {state.error}
      </p>
    );
  if (state.message)
    return (
      <p role="status" className="rounded-sm bg-brand-tint p-3 font-medium text-brand-deep">
        {state.message}
      </p>
    );
  return null;
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: (p: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) => ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-micro font-medium">
        {label}
      </label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": hint || error ? `${id}-d` : undefined })}
      {(hint || error) && (
        <p id={`${id}-d`} className={`mt-1 text-caption ${error ? "text-error" : "text-ink-muted"}`}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

function useRun() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<SimpleResult>({});
  const run = (fn: () => Promise<SimpleResult>, then?: (r: SimpleResult) => void) => {
    setResult({});
    start(async () => {
      const r = await fn();
      setResult(r);
      then?.(r);
    });
  };
  return { pending, result, run };
}

function Result({ r }: { r: SimpleResult }) {
  if (r.error)
    return (
      <p role="alert" className="text-caption text-error">
        {r.error}
      </p>
    );
  if (r.message)
    return (
      <p role="status" className="text-caption font-medium text-brand-deep">
        {r.message}
      </p>
    );
  return null;
}

// ---------- Expenses ----------

export interface ExpenseDefaults {
  listingId?: string;
  date?: string;
  category?: string;
  description?: string;
  supplier?: string;
  amount?: string;
  paidBy?: string;
  rebillToOwner?: string;
  ticketId?: string;
}

/** New expense (with its receipt) or a draft's changes. */
export function ExpenseForm({ listings, today, expenseId, defaults = {} }: { listings: { id: string; title: string }[]; today: string; expenseId?: string; defaults?: ExpenseDefaults }) {
  const action = expenseId ? updateExpenseAction.bind(null, expenseId) : createExpenseAction;
  const [state, formAction, pending] = useActionState<FinanceFormState, FormData>(action, {});
  const v = (k: keyof ExpenseDefaults, d = "") => state.values?.[k] ?? defaults[k] ?? d;
  const e = (state.fieldErrors ?? {}) as Record<string, string>;
  return (
    <form action={formAction} key={expenseId ? undefined : (state.saved ?? 0)} noValidate className={`${card} space-y-4`} data-testid="expense-form" aria-label={expenseId ? "Modifier la dépense" : "Nouvelle dépense"}>
      <h2 className="text-title-s font-semibold">{expenseId ? "Modifier le brouillon" : "Nouvelle dépense"}</h2>
      <Notice state={state} />
      {state.id && !expenseId && (
        <p>
          <Link href={`/admin/finances/depenses/${state.id}`} className="font-semibold underline underline-offset-2" data-testid="expense-created-link">
            Ouvrir la dépense pour la valider
          </Link>
        </p>
      )}
      <input type="hidden" name="ticketId" value={v("ticketId")} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Bien" error={e.listingId}>
          {(p) => (
            <select {...p} name="listingId" defaultValue={v("listingId")} className={input}>
              <option value="">—</option>
              {listings.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Date (facture, achat)" error={e.date}>
          {(p) => <input {...p} name="date" type="date" max={today} defaultValue={v("date", today)} className={input} />}
        </Field>
        <Field label="Catégorie" error={e.category}>
          {(p) => (
            <select {...p} name="category" defaultValue={v("category", "REPAIR")} className={input}>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {EXPENSE_CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Montant TTC (MAD)" hint="Deux décimales au plus, ex. 349,90." error={e.amount}>
          {(p) => <input {...p} name="amount" inputMode="decimal" defaultValue={v("amount")} className={input} />}
        </Field>
        <div className="sm:col-span-2">
          <Field label="Description" error={e.description}>
            {(p) => <input {...p} name="description" maxLength={500} defaultValue={v("description")} className={input} />}
          </Field>
        </div>
        <Field label="Fournisseur (facultatif)" error={e.supplier}>
          {(p) => <input {...p} name="supplier" maxLength={120} defaultValue={v("supplier")} className={input} />}
        </Field>
        <Field label="Payée par" error={e.paidBy}>
          {(p) => (
            <select {...p} name="paidBy" defaultValue={v("paidBy", "SIGMA")} className={input}>
              <option value="SIGMA">Sigma</option>
              <option value="OWNER">Le propriétaire</option>
            </select>
          )}
        </Field>
        <label className="flex min-h-11 items-center gap-2 sm:col-span-2">
          <input type="checkbox" name="rebillToOwner" defaultChecked={v("rebillToOwner", "on") === "on"} className="size-5 accent-brand" />
          À la charge du propriétaire (refacturée, déduite de son relevé)
        </label>
        {!expenseId && (
          <div className="sm:col-span-2">
            <Field label="Justificatif (photo ou PDF, 5 Mo au plus)" hint="Facture, ticket de caisse… Il peut aussi être ajouté plus tard.">
              {(p) => <input {...p} name="receipt" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="block w-full text-body" />}
            </Field>
          </div>
        )}
      </div>
      <Button type="submit" variant="primary" disabled={pending}>
        {expenseId ? "Enregistrer les modifications" : "Enregistrer en brouillon"}
      </Button>
    </form>
  );
}

export function ReceiptUpload({ expenseId, replace }: { expenseId: string; replace: boolean }) {
  const { pending, result, run } = useRun();
  const id = useId();
  return (
    <form
      className="space-y-2"
      aria-live="polite"
      onSubmit={(ev) => {
        ev.preventDefault();
        const form = new FormData(ev.currentTarget);
        run(() => uploadReceiptAction(expenseId, form));
      }}
      data-testid="receipt-upload"
    >
      <label htmlFor={id} className="block text-micro font-medium">
        {replace ? "Remplacer le justificatif" : "Ajouter le justificatif"} (photo ou PDF, 5 Mo au plus)
      </label>
      <input id={id} name="receipt" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="block w-full text-body" />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        <Paperclip className="size-4" aria-hidden="true" />
        Envoyer
      </Button>
      <Result r={result} />
    </form>
  );
}

export function ExpenseButtons({ expenseId, status }: { expenseId: string; status: "DRAFT" | "VALIDATED" | "REVERSED" }) {
  const { pending, result, run } = useRun();
  const router = useRouter();
  const [reason, setReason] = useState("");
  const reasonId = useId();
  return (
    <div className="space-y-3" aria-live="polite">
      {status === "DRAFT" && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="primary" size="sm" disabled={pending} onClick={() => confirm("Valider cette dépense ? Elle sera passée au journal et ne pourra plus être modifiée.") && run(() => validateExpenseAction(expenseId))} data-testid="expense-validate">
            <Check className="size-4" aria-hidden="true" />
            Valider
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => confirm("Supprimer ce brouillon ?") && run(() => deleteExpenseAction(expenseId), (r) => !r.error && router.push("/admin/finances/depenses"))}>
            <Trash2 className="size-4" aria-hidden="true" />
            Supprimer le brouillon
          </Button>
        </div>
      )}
      {status === "VALIDATED" && (
        <div className="space-y-2">
          <label htmlFor={reasonId} className="block text-micro font-medium">
            Raison de la contre-passation
          </label>
          <input id={reasonId} value={reason} onChange={(ev) => setReason(ev.target.value)} maxLength={500} className={input} />
          <Button type="button" variant="outline" size="sm" disabled={pending || reason.trim().length < 2} onClick={() => confirm("Contre-passer cette dépense ? Une écriture inverse sera passée au journal.") && run(() => reverseExpenseAction(expenseId, reason))}>
            <Undo2 className="size-4" aria-hidden="true" />
            Contre-passer
          </Button>
        </div>
      )}
      <Result r={result} />
    </div>
  );
}

// ---------- Closing ----------

export function MonthClosing({ month, label, closed, closable, warnings }: { month: string; label: string; closed: boolean; closable: boolean; warnings: string[] }) {
  const { pending, result, run } = useRun();
  const [reason, setReason] = useState("");
  const reasonId = useId();
  return (
    <div className="space-y-2" aria-live="polite" data-testid="month-closing">
      {closed ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-60 flex-1">
            <label htmlFor={reasonId} className="mb-1 block text-micro font-medium">
              Raison de la réouverture
            </label>
            <input id={reasonId} value={reason} onChange={(ev) => setReason(ev.target.value)} maxLength={500} className={input} />
          </div>
          <Button type="button" variant="outline" size="sm" disabled={pending || reason.trim().length < 2} onClick={() => confirm(`Rouvrir ${label} ? Ses écritures pourront de nouveau changer.`) && run(() => reopenMonthAction(month, reason))}>
            <Unlock className="size-4" aria-hidden="true" />
            Rouvrir le mois
          </Button>
        </div>
      ) : closable ? (
        <Button
          type="button"
          variant="dark"
          size="sm"
          disabled={pending}
          data-testid="close-month"
          onClick={() => confirm(`Clôturer ${label} ?${warnings.length ? `\n\nAttention : ${warnings.join(" ; ")}.` : ""}\n\nLes loyers de sous-location du mois seront passés et ses écritures ne changeront plus : toute modification ultérieure ira en ajustement sur le premier mois ouvert.`) && run(() => closeMonthAction(month))}
        >
          <Lock className="size-4" aria-hidden="true" />
          Clôturer {label}
        </Button>
      ) : (
        <p className="text-caption text-ink-muted">Le mois pourra être clôturé une fois terminé.</p>
      )}
      <Result r={result} />
    </div>
  );
}

// ---------- A booking's split ----------

export function SplitInputsForm({ bookingId, defaults, foreignCurrency, direct }: { bookingId: string; defaults: { gross: string; platformFee: string; fxRate: string; note: string }; foreignCurrency: string | null; direct: boolean }) {
  const [state, formAction, pending] = useActionState<FinanceFormState, FormData>(setSplitInputsAction.bind(null, bookingId), {});
  const v = (k: keyof typeof defaults) => state.values?.[k] ?? defaults[k];
  const e = (state.fieldErrors ?? {}) as Record<string, string>;
  return (
    <form action={formAction} noValidate className="space-y-3 rounded-sm border border-line-soft p-3" data-testid="split-inputs" aria-label="Saisie de la répartition">
      <p className="text-caption text-ink-muted">Laisser vide = valeur de la réservation (ou estimation). Chaque saisie recalcule la répartition et passe les écarts au journal.</p>
      <Notice state={state} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Revenu brut payé par le voyageur (MAD)" hint="Hors taxe de séjour, ménage compris." error={e.gross}>
          {(p) => <input {...p} name="gross" inputMode="decimal" defaultValue={v("gross")} className={input} />}
        </Field>
        {!direct && (
          <Field label="Frais de plateforme (MAD)" hint="D'après le relevé de la plateforme." error={e.platformFee}>
            {(p) => <input {...p} name="platformFee" inputMode="decimal" defaultValue={v("platformFee")} className={input} />}
          </Field>
        )}
        {foreignCurrency && (
          <Field label={`Taux de change : MAD pour 1 ${foreignCurrency}`} hint="Taux retenu avec le comptable (relevé de la plateforme, banque du jour du versement…)." error={e.fxRate}>
            {(p) => <input {...p} name="fxRate" inputMode="decimal" defaultValue={v("fxRate")} className={input} />}
          </Field>
        )}
        <div className="sm:col-span-2">
          <Field label="Note (facultatif)" error={e.note}>
            {(p) => <input {...p} name="note" maxLength={500} defaultValue={v("note")} className={input} />}
          </Field>
        </div>
      </div>
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        Recalculer avec ces valeurs
      </Button>
    </form>
  );
}

export function ReapplyTermsButton({ bookingId }: { bookingId: string }) {
  const { pending, result, run } = useRun();
  return (
    <div className="space-y-1" aria-live="polite">
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => confirm("Remplacer les conditions gardées sur cette réservation par celles du bien aujourd'hui ?") && run(() => reapplyTermsAction(bookingId))}>
        <RefreshCw className="size-4" aria-hidden="true" />
        Réappliquer les conditions du bien
      </Button>
      <Result r={result} />
    </div>
  );
}

// ---------- Settings ----------

export function FinanceSettingsForm({ defaults }: { defaults: Record<string, string> }) {
  const [state, formAction, pending] = useActionState<FinanceFormState, FormData>(saveFinanceSettingsAction, {});
  const v = (k: string) => state.values?.[k] ?? defaults[k] ?? "";
  const e = (state.fieldErrors ?? {}) as Record<string, string>;
  return (
    <form action={formAction} noValidate className={`${card} space-y-4`} data-testid="finance-settings" aria-label="Paramètres financiers">
      <h2 className="text-title-s font-semibold">Règles de répartition de l&apos;organisation</h2>
      <Notice state={state} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Frais de ménage gardés par (par défaut)" hint="Un bien peut avoir sa propre règle (ex. gestion à distance)." error={e.cleaningBeneficiary}>
          {(p) => (
            <select {...p} name="cleaningBeneficiary" defaultValue={v("cleaningBeneficiary")} className={input}>
              {(["SIGMA", "OWNER"] as const).map((b) => (
                <option key={b} value={b}>
                  {BENEFICIARY_LABEL[b]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Base de la commission" error={e.commissionBase}>
          {(p) => (
            <select {...p} name="commissionBase" defaultValue={v("commissionBase")} className={input}>
              {(["NET_EXCL_CLEANING", "GROSS_EXCL_CLEANING"] as const).map((b) => (
                <option key={b} value={b}>
                  {COMMISSION_BASE_LABEL[b]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Séjour à cheval sur deux mois" error={e.allocation}>
          {(p) => (
            <select {...p} name="allocation" defaultValue={v("allocation")} className={input}>
              {(["NIGHTS", "CHECKOUT"] as const).map((b) => (
                <option key={b} value={b}>
                  {ALLOCATION_LABEL[b]}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <fieldset className="space-y-2">
        <legend className="font-semibold">Frais de plateforme par défaut (%)</legend>
        <p className="text-caption text-ink-muted">Utilisés seulement quand les vrais frais ne sont pas connus (estimation affichée comme telle). Valeurs de départ provisoires, à remplacer par celles des contrats de Sigma.</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {PLATFORM_SOURCES.map((p) => (
            <Field key={p} label={PLATFORM_NAME[p]} error={e[`fee_${p}`]}>
              {(f) => <input {...f} name={`fee_${p}`} inputMode="decimal" defaultValue={v(`fee_${p}`)} className={input} />}
            </Field>
          ))}
        </div>
      </fieldset>
      <Button type="submit" variant="primary" disabled={pending}>
        Enregistrer
      </Button>
    </form>
  );
}

export function ListingTermsForm({ listingId, sublease, defaults }: { listingId: string; sublease: boolean; defaults: { cleaningFeeBeneficiary: string; subleaseRent: string; subleaseRentFrom: string } }) {
  const [state, formAction, pending] = useActionState<FinanceFormState, FormData>(saveListingTermsAction.bind(null, listingId), {});
  const v = (k: keyof typeof defaults) => state.values?.[k] ?? defaults[k];
  const e = (state.fieldErrors ?? {}) as Record<string, string>;
  return (
    <form action={formAction} noValidate className="flex flex-wrap items-end gap-3" data-testid="listing-terms" data-listing={listingId}>
      {!sublease && (
        <div className="min-w-48">
          <Field label="Ménage gardé par" error={e.cleaningFeeBeneficiary}>
            {(p) => (
              <select {...p} name="cleaningFeeBeneficiary" defaultValue={v("cleaningFeeBeneficiary")} className={input}>
                <option value="">Règle de l&apos;organisation</option>
                <option value="SIGMA">Sigma</option>
                <option value="OWNER">Le propriétaire</option>
              </select>
            )}
          </Field>
        </div>
      )}
      {sublease && (
        <>
          <div className="w-40">
            <Field label="Loyer mensuel (MAD)" error={e.subleaseRent}>
              {(p) => <input {...p} name="subleaseRent" inputMode="decimal" defaultValue={v("subleaseRent")} className={input} />}
            </Field>
          </div>
          <div className="w-44">
            <Field label="À partir du" error={e.subleaseRentFrom}>
              {(p) => <input {...p} name="subleaseRentFrom" type="date" defaultValue={v("subleaseRentFrom")} className={input} />}
            </Field>
          </div>
        </>
      )}
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        Enregistrer
      </Button>
      {(state.error || state.message) && (
        <div className="w-full">
          <Notice state={state} />
        </div>
      )}
    </form>
  );
}

export function AdjustmentForm({ listings, months }: { listings: { id: string; title: string }[]; months: string[] }) {
  const [state, formAction, pending] = useActionState<FinanceFormState, FormData>(addAdjustmentAction, {});
  const v = (k: string, d = "") => state.values?.[k] ?? d;
  const e = (state.fieldErrors ?? {}) as Record<string, string>;
  return (
    <form action={formAction} key={state.saved ?? 0} noValidate className={`${card} space-y-4`} data-testid="adjustment-form" aria-label="Ajustement manuel">
      <h2 className="text-title-s font-semibold">Ajustement manuel</h2>
      <p className="text-caption text-ink-muted">Geste commercial, régularisation convenue avec un propriétaire… Passé au journal dans un mois ouvert, jamais modifiable.</p>
      <Notice state={state} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Bien" error={e.listingId}>
          {(p) => (
            <select {...p} name="listingId" defaultValue={v("listingId")} className={input}>
              <option value="">—</option>
              {listings.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Mois" error={e.month}>
          {(p) => (
            <select {...p} name="month" defaultValue={v("month", months[0])} className={input}>
              {months.map((m) => (
                <option key={m} value={m}>
                  {m.slice(5, 7)}/{m.slice(0, 4)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Sens" error={e.direction}>
          {(p) => (
            <select {...p} name="direction" defaultValue={v("direction", "credit")} className={input}>
              <option value="credit">En faveur du propriétaire</option>
              <option value="debit">À la charge du propriétaire</option>
            </select>
          )}
        </Field>
        <Field label="Montant (MAD)" error={e.amount}>
          {(p) => <input {...p} name="amount" inputMode="decimal" defaultValue={v("amount")} className={input} />}
        </Field>
        <div className="sm:col-span-2">
          <Field label="Raison" error={e.reason}>
            {(p) => <input {...p} name="reason" maxLength={300} defaultValue={v("reason")} className={input} />}
          </Field>
        </div>
      </div>
      <Button type="submit" variant="primary" disabled={pending}>
        Passer l&apos;ajustement
      </Button>
    </form>
  );
}
