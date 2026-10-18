"use client";

import Link from "next/link";
import { useActionState, useId, useRef, useState, type ReactNode } from "react";
import type { FormState } from "@/app/admin/biens/actions";
import { Button } from "@/components/ui/Button";
import { LIMITS, MANAGEMENT_TYPE_LABEL, type FieldErrors, type FormValues, type ListingFieldName } from "@/lib/admin/listing-form";
import { PROPERTY_TYPE_LABEL } from "@/lib/labels";

export interface ListingFormOptions {
  owners: { id: string; name: string; email: string }[];
  places: { id: string; name: string; lat: number; lng: number }[];
  amenities: { id: string; label: string; group: string }[];
}

const input =
  "h-11 w-full rounded-sm border border-ink-faint bg-white px-3 text-body-l outline-none focus:border-ink focus:ring-1 focus:ring-ink aria-[invalid=true]:border-error disabled:bg-surface-3 disabled:text-ink-muted";
const area = `${input} h-auto min-h-28 py-2`;

/**
 * Create / edit form of a listing (Biens). Validation is the server's (lib/admin/listing-form.ts); the browser
 * only adds required/min hints. After an error the action sends the typed values back, and the fields are drawn
 * again from them.
 */
export function ListingForm({
  action,
  options,
  initial,
  mode,
  cancelHref,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  options: ListingFormOptions;
  initial: FormValues;
  mode: "create" | "edit";
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const values = (state.values as FormValues | undefined) ?? initial;
  const errors: FieldErrors = state.fieldErrors ?? {};
  const [management, setManagement] = useState(String(values.managementType ?? "MANAGED"));
  const lat = useRef<HTMLInputElement>(null);
  const lng = useRef<HTMLInputElement>(null);
  const v = (k: ListingFieldName) => {
    const x = values[k];
    return typeof x === "string" ? x : "";
  };
  const checked = new Set(Array.isArray(values.amenityIds) ? values.amenityIds : []);
  const groups = [...new Set(options.amenities.map((a) => a.group))];

  return (
    <form action={formAction} noValidate className="space-y-6" aria-describedby={state.error ? "form-error" : undefined}>
      {state.error && (
        <div id="form-error" role="alert" className="rounded-lg border border-error bg-[#fdecea] p-4 text-error">
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

      {/* React resets the form after each answer; the fields then take the values sent back (defaultValue). */}
      <div className="space-y-6">
        <Section title="Description">
          <Field name="title" label="Titre" error={errors.title} className="sm:col-span-2">
            {(p) => <input {...p} name="title" required maxLength={LIMITS.title} defaultValue={v("title")} className={input} />}
          </Field>
          <Field name="propertyType" label="Type de logement" error={errors.propertyType}>
            {(p) => (
              <select {...p} name="propertyType" required defaultValue={v("propertyType")} className={input}>
                <option value="">Choisir…</option>
                {Object.entries(PROPERTY_TYPE_LABEL).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field name="description" label="Description" error={errors.description} className="sm:col-span-2">
            {(p) => <textarea {...p} name="description" required rows={5} maxLength={LIMITS.description} defaultValue={v("description")} className={area} />}
          </Field>
        </Section>

        <Section title="Capacité">
          <Field name="maxGuests" label="Voyageurs" error={errors.maxGuests}>
            {(p) => <input {...p} name="maxGuests" inputMode="numeric" required defaultValue={v("maxGuests")} className={input} />}
          </Field>
          <Field name="bedrooms" label="Chambres" error={errors.bedrooms}>
            {(p) => <input {...p} name="bedrooms" inputMode="numeric" required defaultValue={v("bedrooms")} className={input} />}
          </Field>
          <Field name="beds" label="Lits" error={errors.beds}>
            {(p) => <input {...p} name="beds" inputMode="numeric" required defaultValue={v("beds")} className={input} />}
          </Field>
          <Field name="bathrooms" label="Salles de bain" hint="Demi possible : 1,5" error={errors.bathrooms}>
            {(p) => <input {...p} name="bathrooms" inputMode="decimal" required defaultValue={v("bathrooms")} className={input} />}
          </Field>
        </Section>

        <Section title="Adresse et carte" intro="L'adresse exacte reste interne (équipe, guide d'accueil) : le site public n'affiche que le quartier.">
          <Field name="address" label="Adresse" error={errors.address} className="sm:col-span-2">
            {(p) => <input {...p} name="address" required maxLength={LIMITS.address} autoComplete="street-address" defaultValue={v("address")} className={input} />}
          </Field>
          <Field name="city" label="Ville" error={errors.city}>
            {(p) => <input {...p} name="city" required maxLength={LIMITS.city} defaultValue={v("city")} className={input} />}
          </Field>
          <Field name="placeId" label="Quartier" error={errors.placeId}>
            {(p) => (
              <select
                {...p}
                name="placeId"
                required
                defaultValue={v("placeId")}
                className={input}
                onChange={(e) => {
                  // A new neighbourhood pre-fills the coordinates with its centre, when none are typed yet.
                  const place = options.places.find((x) => x.id === e.target.value);
                  if (place && lat.current && lng.current && !lat.current.value && !lng.current.value) {
                    lat.current.value = String(place.lat).replace(".", ",");
                    lng.current.value = String(place.lng).replace(".", ",");
                  }
                }}
              >
                <option value="">Choisir…</option>
                {options.places.map((pl) => (
                  <option key={pl.id} value={pl.id}>
                    {pl.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field name="lat" label="Latitude" hint="Ex. 31,6295" error={errors.lat}>
            {(p) => <input {...p} ref={lat} name="lat" inputMode="decimal" required defaultValue={v("lat")} className={input} />}
          </Field>
          <Field name="lng" label="Longitude" hint="Ex. -8,0083" error={errors.lng}>
            {(p) => <input {...p} ref={lng} name="lng" inputMode="decimal" required defaultValue={v("lng")} className={input} />}
          </Field>
        </Section>

        <fieldset className="rounded-lg border border-line bg-white p-4 md:p-6">
          <legend className="px-1 text-title-s font-semibold">Équipements</legend>
          {errors.amenityIds && <p className="mt-1 text-error">{errors.amenityIds}</p>}
          <div className="mt-2 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((g) => (
              <div key={g}>
                <p className="mb-2 font-semibold">{g}</p>
                <ul className="space-y-1.5">
                  {options.amenities
                    .filter((a) => a.group === g)
                    .map((a) => (
                      <li key={a.id}>
                        <label className="flex items-center gap-2">
                          <input type="checkbox" name="amenityIds" value={a.id} defaultChecked={checked.has(a.id)} className="size-4 accent-brand" />
                          {a.label}
                        </label>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        </fieldset>

        <Section title="Règlement intérieur">
          <Field name="houseRules" label="Règles de la maison" hint="Une règle par ligne : arrivée, départ, bruit, fêtes, tabac…" error={errors.houseRules} className="sm:col-span-2">
            {(p) => <textarea {...p} name="houseRules" rows={4} maxLength={LIMITS.houseRules} defaultValue={v("houseRules")} className={area} />}
          </Field>
        </Section>

        <Section title="Propriétaire et gestion">
          <Field
            name="ownerId"
            label="Propriétaire"
            error={errors.ownerId}
            hint={options.owners.length === 0 ? "Aucun compte propriétaire dans l'organisation : créez-en un d'abord (Utilisateurs)." : undefined}
            className="sm:col-span-2"
          >
            {(p) => (
              <select {...p} name="ownerId" required defaultValue={v("ownerId")} className={input}>
                <option value="">Choisir…</option>
                {options.owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} ({o.email})
                  </option>
                ))}
              </select>
            )}
          </Field>
          <fieldset className="sm:col-span-2">
            <legend className="mb-1 text-micro font-medium">Type de gestion</legend>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {(["MANAGED", "SUBLEASE"] as const).map((t) => (
                <label key={t} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="managementType"
                    value={t}
                    checked={management === t}
                    onChange={() => setManagement(t)}
                    className="size-4 accent-brand"
                  />
                  {MANAGEMENT_TYPE_LABEL[t]}
                </label>
              ))}
            </div>
            {errors.managementType && <p className="mt-1 text-error">{errors.managementType}</p>}
          </fieldset>
          <Field
            name="commission"
            label="Commission Sigma (%)"
            error={errors.commission}
            hint={
              management === "SUBLEASE"
                ? "Sous-location : pas de commission. Sigma perçoit les revenus et verse un loyer au propriétaire."
                : "Part des revenus locatifs, ex. 20 ou 17,5."
            }
          >
            {(p) =>
              management === "SUBLEASE" ? (
                <input {...p} disabled value="—" readOnly className={input} />
              ) : (
                <input {...p} name="commission" inputMode="decimal" required defaultValue={v("commission")} className={input} />
              )
            }
          </Field>
        </Section>

        <Section title="Autorisation loi 80-14" intro="Laissez vide tant que la demande est en cours. Une alerte apparaît 60 jours avant l'expiration.">
          <Field name="licenseNumber" label="Numéro d'autorisation" error={errors.licenseNumber}>
            {(p) => <input {...p} name="licenseNumber" maxLength={LIMITS.licenseNumber} defaultValue={v("licenseNumber")} className={input} />}
          </Field>
          <Field name="licenseExpiresAt" label="Date d'expiration" error={errors.licenseExpiresAt}>
            {(p) => <input {...p} type="date" name="licenseExpiresAt" defaultValue={v("licenseExpiresAt")} className={input} />}
          </Field>
        </Section>

        <Section title="Prix et séjour" intro="Montants en dirhams (MAD). Les prix par saison et par événement viennent avec la section Prix.">
          <Field name="price" label="Prix par nuit (MAD)" error={errors.price}>
            {(p) => <input {...p} name="price" inputMode="decimal" required defaultValue={v("price")} className={input} />}
          </Field>
          <Field name="cleaningFee" label="Frais de ménage (MAD)" error={errors.cleaningFee}>
            {(p) => <input {...p} name="cleaningFee" inputMode="decimal" defaultValue={v("cleaningFee")} className={input} />}
          </Field>
          <Field name="minNights" label="Séjour minimum (nuits)" error={errors.minNights}>
            {(p) => <input {...p} name="minNights" inputMode="numeric" required defaultValue={v("minNights")} className={input} />}
          </Field>
        </Section>

        {mode === "create" ? (
          <input type="hidden" name="status" value="DRAFT" />
        ) : (
          <fieldset className="rounded-lg border border-line bg-white p-4 md:p-6">
            <legend className="px-1 text-title-s font-semibold">Publication</legend>
            <div className="mt-1 flex flex-wrap gap-x-6 gap-y-2">
              {(
                [
                  ["DRAFT", "Brouillon (invisible sur le site)"],
                  ["PUBLISHED", "Publié sur le site"],
                ] as const
              ).map(([s, label]) => (
                <label key={s} className="flex items-center gap-2">
                  <input type="radio" name="status" value={s} defaultChecked={v("status") === s} className="size-4 accent-brand" />
                  {label}
                </label>
              ))}
            </div>
            {errors.status && <p className="mt-1 text-error">{errors.status}</p>}
          </fieldset>
        )}
      </div>

      {mode === "create" && <p className="text-ink-muted">Le bien est créé en brouillon : ajoutez ensuite les photos, puis publiez-le.</p>}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Link href={cancelHref} className="inline-flex h-12 items-center justify-center rounded-sm px-6 font-semibold underline underline-offset-2">
          Annuler
        </Link>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Enregistrement…" : mode === "create" ? "Créer le bien" : "Enregistrer"}
        </Button>
      </div>
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

function Field({
  name,
  label,
  hint,
  error,
  className,
  children,
}: {
  name: string;
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children: (props: FieldProps) => ReactNode;
}) {
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
