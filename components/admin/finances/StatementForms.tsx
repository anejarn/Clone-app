"use client";

import { FileText, RefreshCw, Undo2 } from "lucide-react";
import { useActionState, useId, useState, useTransition, type ReactNode } from "react";
import { generateStatementsAction, recordPayoutAction, regenerateStatementAction, reversePayoutAction, saveBrandingAction, type FinanceFormState, type SimpleResult } from "@/app/admin/finances/actions";
import { Button } from "@/components/ui/Button";
import { Notice } from "./FinanceForms";

/** Owner statements (Finances → Relevés) and the statements' header (Paramètres), ADMIN; the actions check again. */

const input =
  "h-11 w-full rounded-sm border border-ink-faint bg-white px-3 text-body-l outline-none focus:border-ink focus:ring-1 focus:ring-ink aria-[invalid=true]:border-error";

function useRun() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<SimpleResult>({});
  const run = (fn: () => Promise<SimpleResult>) => {
    setResult({});
    start(async () => setResult(await fn()));
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

export function GenerateStatementsButton({ month, label }: { month: string; label: string }) {
  const { pending, result, run } = useRun();
  return (
    <div className="space-y-1" aria-live="polite" data-testid="generate-statements">
      <Button type="button" variant="dark" size="sm" disabled={pending} onClick={() => run(() => generateStatementsAction(month))}>
        <FileText className="size-4" aria-hidden="true" />
        {pending ? "Génération…" : `Générer les relevés de ${label}`}
      </Button>
      <Result r={result} />
    </div>
  );
}

export function RegenerateButton({ ownerId, month, ownerName }: { ownerId: string; month: string; ownerName: string }) {
  const { pending, result, run } = useRun();
  return (
    <div className="space-y-1" aria-live="polite">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => confirm(`Générer une nouvelle version du relevé de ${ownerName} ? L'ancienne reste archivée.`) && run(() => regenerateStatementAction(ownerId, month))}
      >
        <RefreshCw className="size-4" aria-hidden="true" />
        Nouvelle version
      </Button>
      <Result r={result} />
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: (p: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) => ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-micro font-medium">
        {label}
      </label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": error ? `${id}-e` : undefined })}
      {error && (
        <p id={`${id}-e`} className="mt-1 text-caption text-error">
          {error}
        </p>
      )}
    </div>
  );
}

/** « Virement effectué »: date, bank reference, amount (defaults to what is left to pay). */
export function PayoutForm({ ownerId, month, defaultAmount, today }: { ownerId: string; month: string; defaultAmount: string; today: string }) {
  const [state, formAction, pending] = useActionState<FinanceFormState, FormData>(recordPayoutAction.bind(null, ownerId, month), {});
  const e = (state.fieldErrors ?? {}) as Record<string, string>;
  const v = (k: string, d: string) => state.values?.[k] ?? d;
  return (
    <form action={formAction} key={state.saved ?? 0} noValidate className="space-y-3 rounded-sm border border-line-soft p-3" data-testid="payout-form" aria-label="Enregistrer le virement">
      <p className="text-caption font-semibold">Enregistrer le virement effectué</p>
      <Notice state={state} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Date du virement" error={e.paidOn}>
          {(p) => <input {...p} name="paidOn" type="date" max={today} defaultValue={v("paidOn", today)} className={input} />}
        </Field>
        <Field label="Référence bancaire" error={e.reference}>
          {(p) => <input {...p} name="reference" maxLength={100} defaultValue={v("reference", "")} className={input} />}
        </Field>
        <Field label="Montant (MAD)" error={e.amount}>
          {(p) => <input {...p} name="amount" inputMode="decimal" defaultValue={v("amount", defaultAmount)} className={input} />}
        </Field>
      </div>
      <Button type="submit" variant="dark" size="sm" disabled={pending}>
        {pending ? "Un instant…" : "Virement effectué"}
      </Button>
    </form>
  );
}

export function ReversePayoutButton({ id }: { id: string }) {
  const { pending, result, run } = useRun();
  return (
    <span className="inline-flex flex-col">
      <Button
        type="button"
        variant="link"
        disabled={pending}
        onClick={() => {
          const reason = prompt("Raison de l'annulation de ce virement (erreur de saisie, virement rejeté…) :");
          if (reason && reason.trim().length >= 2) run(() => reversePayoutAction(id, reason));
        }}
      >
        <Undo2 className="size-4" aria-hidden="true" />
        Annuler
      </Button>
      <Result r={result} />
    </span>
  );
}

export interface BrandingDefaults {
  legalName: string;
  legalAddress: string;
  ice: string;
  rcNumber: string;
  taxIdNumber: string;
  eurRate: string;
  hasLogo: boolean;
}

/** The header printed on the owners' statements (organization parameters). */
export function BrandingForm({ defaults }: { defaults: BrandingDefaults }) {
  const [state, formAction, pending] = useActionState<FinanceFormState, FormData>(saveBrandingAction, {});
  const e = (state.fieldErrors ?? {}) as Record<string, string>;
  const v = (k: keyof BrandingDefaults) => state.values?.[k] ?? String(defaults[k]);
  return (
    <form action={formAction} noValidate className="space-y-4 rounded-lg border border-line bg-white p-4 md:p-6" data-testid="branding-form" aria-labelledby="branding-title">
      <h2 id="branding-title" className="text-title-s font-semibold">
        En-tête des relevés propriétaires
      </h2>
      <p className="text-caption text-ink-muted">
        Imprimé en haut de chaque relevé PDF. Un champ vide n&apos;est pas imprimé. Les relevés déjà générés gardent leur en-tête : « Générer les relevés » écrit une nouvelle version.
      </p>
      <Notice state={state} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Raison sociale (ex. Sigma SARL)" error={e.legalName}>
          {(p) => <input {...p} name="legalName" maxLength={120} defaultValue={v("legalName")} className={input} />}
        </Field>
        <Field label="Adresse du siège" error={e.legalAddress}>
          {(p) => <input {...p} name="legalAddress" maxLength={300} defaultValue={v("legalAddress")} className={input} />}
        </Field>
        <Field label="ICE (15 chiffres)" error={e.ice}>
          {(p) => <input {...p} name="ice" inputMode="numeric" maxLength={20} defaultValue={v("ice")} className={input} />}
        </Field>
        <Field label="Registre de commerce (RC)" error={e.rcNumber}>
          {(p) => <input {...p} name="rcNumber" maxLength={60} defaultValue={v("rcNumber")} className={input} />}
        </Field>
        <Field label="Identifiant fiscal (IF)" error={e.taxIdNumber}>
          {(p) => <input {...p} name="taxIdNumber" maxLength={30} defaultValue={v("taxIdNumber")} className={input} />}
        </Field>
        <Field label="Taux indicatif : MAD pour 1 EUR (facultatif)" error={e.eurRate}>
          {(p) => <input {...p} name="eurRate" inputMode="decimal" defaultValue={v("eurRate")} className={input} />}
        </Field>
        <Field label="Logo (PNG ou JPEG, 1 Mo au plus)" error={e.logo}>
          {(p) => <input {...p} name="logo" type="file" accept="image/png,image/jpeg" className="block w-full text-body" />}
        </Field>
        {defaults.hasLogo && (
          <label className="flex items-center gap-2 self-end">
            <input type="checkbox" name="removeLogo" className="size-4 accent-brand" />
            <span>Retirer le logo actuel</span>
          </label>
        )}
      </div>
      <Button type="submit" variant="dark" disabled={pending}>
        {pending ? "Un instant…" : "Enregistrer l'en-tête"}
      </Button>
    </form>
  );
}
