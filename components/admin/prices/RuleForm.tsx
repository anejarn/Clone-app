"use client";

import Link from "next/link";
import { useActionState, useId, useState, type ReactNode } from "react";
import type { DeleteRuleState, RuleFormState } from "@/app/admin/prix/actions";
import { Button } from "@/components/ui/Button";
import {
  ADJUSTMENT_TYPE_LABEL,
  ADJUSTMENT_TYPES,
  RULE_KIND_LABEL,
  RULE_KINDS,
  RULE_LIMITS,
  type RuleFieldErrors,
  type RuleFieldName,
  type RuleValues,
} from "@/lib/admin/price-rule-form";
import { formatPrice } from "@/lib/format";
import type { RuleListingOption } from "@/lib/server/admin/prices";

const input =
  "h-11 w-full rounded-sm border border-ink-faint bg-white px-3 text-body-l outline-none focus:border-ink focus:ring-1 focus:ring-ink aria-[invalid=true]:border-error";

/**
 * Create / edit form of a season or an event (Prix). Validation is the server's (lib/admin/price-rule-form.ts,
 * lib/server/admin/prices.ts); after an error the action sends the typed values back and the fields are drawn
 * again from them.
 */
export function RuleForm({
  action,
  listings,
  initial,
  submitLabel,
}: {
  action: (prev: RuleFormState, form: FormData) => Promise<RuleFormState>;
  listings: RuleListingOption[];
  initial: RuleValues;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const values = state.values ?? initial;
  const errors = state.fieldErrors ?? {};
  return (
    <form action={formAction} noValidate className="space-y-6" aria-describedby={state.error ? "rule-error" : undefined} data-testid="rule-form">
      {state.error && (
        <div id="rule-error" role="alert" className="rounded-lg border border-error bg-[#fdecea] p-4 text-error">
          <p className="font-semibold">{state.error}</p>
          {Object.keys(errors).length > 0 && (
            <ul className="mt-2 list-disc pl-5">
              {Object.entries(errors).map(([k, m]) => (
                <li key={k}>{m}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {/* Drawn again from the values sent back after each answer (React resets the form). */}
      <Fields key={JSON.stringify(values)} listings={listings} values={values} errors={errors} />
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Link href="/admin/prix" className="inline-flex h-12 items-center justify-center rounded-sm px-6 font-semibold underline underline-offset-2">
          Annuler
        </Link>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Enregistrement…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

function Fields({ listings, values, errors }: { listings: RuleListingOption[]; values: RuleValues; errors: RuleFieldErrors }) {
  const v = (k: Exclude<RuleFieldName, "listingIds">) => values[k] ?? "";
  const [adjustment, setAdjustment] = useState(v("adjustmentType") || "PERCENT");
  const [scope, setScope] = useState(v("scope") || "ALL");
  const checked = new Set(values.listingIds ?? []);
  const scopeId = useId();

  return (
    <div className="space-y-6">
      <Section title="Saison ou événement">
        <Field name="kind" label="Type" error={errors.kind}>
          {(p) => (
            <select {...p} name="kind" required defaultValue={v("kind") || "SEASON"} className={input}>
              {RULE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {RULE_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field name="name" label="Nom" hint="Ex. « Haute saison de printemps », « Marathon de Marrakech »" error={errors.name}>
          {(p) => <input {...p} name="name" required maxLength={RULE_LIMITS.name} defaultValue={v("name")} autoComplete="off" className={input} />}
        </Field>
        <Field name="startDate" label="Première nuit" error={errors.startDate}>
          {(p) => <input {...p} type="date" name="startDate" required defaultValue={v("startDate")} className={input} />}
        </Field>
        <Field name="endDate" label="Dernière nuit (incluse)" hint="La nuit du dernier jour est comprise." error={errors.endDate}>
          {(p) => <input {...p} type="date" name="endDate" required defaultValue={v("endDate")} className={input} />}
        </Field>
        <label className="flex items-start gap-3 sm:col-span-2">
          <input type="checkbox" name="recurring" defaultChecked={v("recurring") === "on"} className="mt-1 size-4 accent-brand" />
          <span>
            Chaque année aux mêmes dates
            <span className="block text-caption text-ink-muted">
              Pour une saison ou une fête à date fixe (20/12 → 04/01 est accepté). Pas pour le Ramadan ou un festival dont la date change.
            </span>
          </span>
        </label>
      </Section>

      <Section title="Prix et séjour minimum" intro="Une seule règle fixe le prix d'une nuit : celle d'un seul bien avant une sélection, avant tous les biens ; puis un événement avant une saison ; puis la plus haute priorité, puis la plus récente.">
        <Field name="adjustmentType" label="Ajustement" error={errors.adjustmentType}>
          {(p) => (
            <select {...p} name="adjustmentType" required value={adjustment} onChange={(e) => setAdjustment(e.target.value)} className={input}>
              {ADJUSTMENT_TYPES.map((k) => (
                <option key={k} value={k}>
                  {ADJUSTMENT_TYPE_LABEL[k]}
                </option>
              ))}
            </select>
          )}
        </Field>
        {adjustment === "FIXED" ? (
          <Field name="fixed" label="Prix par nuit (MAD)" error={errors.fixed}>
            {(p) => <input {...p} name="fixed" inputMode="decimal" required defaultValue={v("fixed")} className={input} />}
          </Field>
        ) : (
          <Field name="percent" label="Pourcentage (%)" hint="Avec son signe : +20 ou -10. Arrondi au dirham. 0 : prix inchangé, séjour minimum seulement." error={errors.percent}>
            {(p) => <input {...p} name="percent" inputMode="text" required defaultValue={v("percent")} autoComplete="off" className={input} />}
          </Field>
        )}
        <Field name="minNights" label="Séjour minimum (nuits)" hint="Facultatif : s'applique à tout séjour qui a une nuit dans ces dates." error={errors.minNights}>
          {(p) => <input {...p} name="minNights" inputMode="numeric" defaultValue={v("minNights")} className={input} />}
        </Field>
        <Field name="priority" label="Priorité" hint="De 0 à 100 : départage deux règles du même niveau." error={errors.priority}>
          {(p) => <input {...p} name="priority" inputMode="numeric" defaultValue={v("priority") || "0"} className={input} />}
        </Field>
      </Section>

      <fieldset className="rounded-lg border border-line bg-white p-4 md:p-6" aria-describedby={errors.listingIds ? `${scopeId}-error` : undefined}>
        <legend className="px-1 text-title-s font-semibold">Biens concernés</legend>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:gap-6">
          <label className="flex items-center gap-2">
            <input type="radio" name="scope" value="ALL" checked={scope === "ALL"} onChange={() => setScope("ALL")} className="size-4 accent-brand" />
            Tous les biens (y compris ceux ajoutés plus tard)
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="scope" value="SELECTED" checked={scope === "SELECTED"} onChange={() => setScope("SELECTED")} className="size-4 accent-brand" />
            Une sélection de biens
          </label>
        </div>
        {errors.listingIds && (
          <p id={`${scopeId}-error`} className="mt-2 text-caption text-error">
            {errors.listingIds}
          </p>
        )}
        {scope === "SELECTED" && (
          <ul className="mt-3 max-h-80 divide-y divide-line overflow-y-auto rounded-sm border border-line" data-testid="rule-listings">
            {listings.map((l) => (
              <li key={l.id}>
                <label className="flex items-start gap-3 p-3">
                  <input type="checkbox" name="listingIds" value={l.id} defaultChecked={checked.has(l.id)} className="mt-1 size-4 shrink-0 accent-brand" />
                  <span className="min-w-0">
                    <span className="block break-words">{l.title}</span>
                    <span className="block text-caption text-ink-muted">
                      {l.placeName} · base {formatPrice(l.priceCents)} / nuit
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
    </div>
  );
}

/** Deletes the rule (ADMIN), after a confirmation box: prices go back to the other rules or the base price. */
export function DeleteRuleForm({ action }: { action: (prev: DeleteRuleState, form: FormData) => Promise<DeleteRuleState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-line bg-white p-4 md:p-6">
      <h2 className="text-title-s font-semibold">Supprimer la règle</h2>
      <p className="text-ink-muted">Les nuits concernées reprennent le prix des autres règles ou le prix de base. Les réservations déjà enregistrées gardent leur montant.</p>
      {state.error && (
        <p role="alert" className="rounded-sm border border-error bg-[#fdecea] p-3 text-error">
          {state.error}
        </p>
      )}
      <label className="flex items-start gap-3">
        <input type="checkbox" name="confirm" className="mt-1 size-4 accent-brand" />
        <span>Je confirme la suppression</span>
      </label>
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Un instant…" : "Supprimer"}
      </Button>
    </form>
  );
}

function Section({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  return (
    <fieldset className="rounded-lg border border-line bg-white p-4 md:p-6">
      <legend className="px-1 text-title-s font-semibold">{title}</legend>
      {intro && <p className="mt-1 text-ink-muted">{intro}</p>}
      <div className="mt-3 grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

type FieldProps = { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string };

function Field({ name, label, hint, error, className, children }: { name: string; label: string; hint?: string; error?: string; className?: string; children: (props: FieldProps) => ReactNode }) {
  const id = `${useId()}-${name}`;
  const described = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-micro font-medium">
        {label}
      </label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": described })}
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-caption text-ink-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-caption text-error">
          {error}
        </p>
      )}
    </div>
  );
}
