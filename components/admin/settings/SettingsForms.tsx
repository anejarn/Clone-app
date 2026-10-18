"use client";

import { Trash2 } from "lucide-react";
import { useActionState, useId, useState, useTransition, type ReactNode } from "react";
import { addListingRateAction, addOrgRateAction, deleteRateAction, saveRetentionAction, type SettingsFormState } from "@/app/admin/parametres/actions";
import { Button } from "@/components/ui/Button";

/** Paramètres' forms (ADMIN). The server actions validate everything again (app/admin/parametres/actions.ts). */

const input =
  "h-11 w-full rounded-sm border border-ink-faint bg-white px-3 text-body-l outline-none focus:border-ink focus:ring-1 focus:ring-ink aria-[invalid=true]:border-error";
const card = "rounded-lg border border-line bg-white p-4 md:p-6";

function Notice({ state }: { state: { error?: string; message?: string } }) {
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

export function OrgRateForm({ today, first }: { today: string; first: boolean }) {
  const [state, action, pending] = useActionState<SettingsFormState, FormData>(addOrgRateAction, {});
  const v = (k: string, d = "") => state.values?.[k] ?? d;
  const e = state.fieldErrors ?? {};
  const [minors, setMinors] = useState(true);
  return (
    <form action={action} key={state.saved ?? 0} noValidate className={`${card} space-y-4`} data-testid="org-rate-form" aria-label="Nouveau taux de l'organisation">
      <h3 className="text-title-s font-semibold">Nouveau taux de l&apos;organisation</h3>
      <Notice state={state} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="À partir du" hint={first ? "Le premier taux peut commencer dans le passé." : "Aujourd'hui ou plus tard."} error={e.effectiveFrom}>
          {(p) => <input {...p} name="effectiveFrom" type="date" defaultValue={v("effectiveFrom", today)} className={input} />}
        </Field>
        <Field label="Taux par voyageur et par nuit (MAD)" hint="Deux décimales au plus, ex. 12,50." error={e.rate}>
          {(p) => <input {...p} name="rate" inputMode="decimal" defaultValue={v("rate")} className={input} />}
        </Field>
        <div className="space-y-2">
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" name="minorsExempt" defaultChecked={v("minorsExempt", "on") === "on"} onChange={(ev) => setMinors(ev.target.checked)} className="size-5 accent-brand" />
            Mineurs exonérés
          </label>
          <Field label="Âge en dessous duquel un voyageur est exonéré" error={e.minorsAge}>
            {(p) => <input {...p} name="minorsAge" type="number" min={1} max={25} defaultValue={v("minorsAge", "18")} disabled={!minors} className={input} />}
          </Field>
        </div>
        <label className="flex min-h-11 items-center gap-2 self-start">
          <input type="checkbox" name="residentsExempt" defaultChecked={v("residentsExempt") === "on"} className="size-5 accent-brand" />
          Résidents au Maroc exonérés
        </label>
        <div className="sm:col-span-2">
          <Field label="Source (facultatif)" hint="Délibération communale, courrier du comptable…" error={e.note}>
            {(p) => <input {...p} name="note" maxLength={200} defaultValue={v("note")} className={input} />}
          </Field>
        </div>
      </div>
      <Button type="submit" variant="primary" disabled={pending}>
        Enregistrer le taux
      </Button>
    </form>
  );
}

export function ListingRateForm({ listings, today }: { listings: { id: string; title: string }[]; today: string }) {
  const [state, action, pending] = useActionState<SettingsFormState, FormData>(addListingRateAction, {});
  const v = (k: string, d = "") => state.values?.[k] ?? d;
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} key={state.saved ?? 0} noValidate className={`${card} space-y-4`} data-testid="listing-rate-form" aria-label="Taux propre à un bien">
      <h3 className="text-title-s font-semibold">Taux propre à un bien</h3>
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
        <Field label="À partir du" error={e.effectiveFrom}>
          {(p) => <input {...p} name="effectiveFrom" type="date" defaultValue={v("effectiveFrom", today)} className={input} />}
        </Field>
        <Field label="Taux du bien (MAD)" error={e.rate}>
          {(p) => <input {...p} name="rate" inputMode="decimal" defaultValue={v("rate")} className={input} />}
        </Field>
        <label className="flex min-h-11 items-center gap-2 self-end">
          <input type="checkbox" name="useOrgRate" defaultChecked={v("useOrgRate") === "on"} className="size-5 accent-brand" />
          Revenir au taux de l&apos;organisation à cette date
        </label>
        <div className="sm:col-span-2">
          <Field label="Source (facultatif)" error={e.note}>
            {(p) => <input {...p} name="note" maxLength={200} defaultValue={v("note")} className={input} />}
          </Field>
        </div>
      </div>
      <Button type="submit" variant="primary" disabled={pending}>
        Enregistrer le taux du bien
      </Button>
    </form>
  );
}

export function RetentionForm({ days }: { days: number }) {
  const [state, action, pending] = useActionState<SettingsFormState, FormData>(saveRetentionAction, {});
  return (
    <form action={action} noValidate className={`${card} space-y-4`} data-testid="retention-form" aria-label="Durée de conservation">
      <Notice state={state} />
      <Field label="Durée de conservation après le départ (jours)" hint="Entre 1 et 3650 jours." error={state.fieldErrors?.retentionDays}>
        {(p) => <input {...p} name="retentionDays" type="number" min={1} max={3650} defaultValue={state.values?.retentionDays ?? String(days)} className={`${input} max-w-48`} />}
      </Field>
      <Button type="submit" variant="primary" disabled={pending}>
        Enregistrer la durée
      </Button>
    </form>
  );
}

export function RateDeleteButton({ kind, id }: { kind: "org" | "listing"; id: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="text-error"
        disabled={pending}
        onClick={() =>
          confirm("Supprimer ce taux, qui n'est pas encore en vigueur ?") &&
          start(async () => {
            const r = await deleteRateAction(kind, id);
            setError(r.error ?? null);
          })
        }
      >
        <Trash2 className="size-4" aria-hidden="true" />
        Supprimer
      </Button>
      {error && (
        <p role="alert" className="text-caption text-error">
          {error}
        </p>
      )}
    </div>
  );
}
