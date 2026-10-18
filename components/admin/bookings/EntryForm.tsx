"use client";

import Link from "next/link";
import { useActionState, useId, useState, type ReactNode } from "react";
import type { EntryState } from "@/app/admin/reservations/actions";
import { Button } from "@/components/ui/Button";
import { directAmounts, ENTRY_LIMITS, type EntryFieldErrors, type EntryFieldName, type EntryKind, type EntryValues } from "@/lib/admin/booking-form";
import { CHANNEL_LABEL, CHANNELS, PLATFORM_SOURCES, SOURCE_LABEL } from "@/lib/admin/booking-sources";
import { daysBetween, parseDay } from "@/lib/admin/calendar";
import { formatPrice, pluralize } from "@/lib/format";
import { centimesToDirhams, dirhamsToCentimes } from "@/lib/money";
import type { EntryListing } from "@/lib/server/admin/bookings";

const input =
  "h-11 w-full rounded-sm border border-ink-faint bg-white px-3 text-body-l outline-none focus:border-ink focus:ring-1 focus:ring-ink aria-[invalid=true]:border-error";
const area = `${input} h-auto min-h-24 py-2`;

const SUBMIT: Record<EntryKind, string> = {
  directe: "Enregistrer la réservation",
  plateforme: "Enregistrer la réservation",
  blocage: "Bloquer ces dates",
};

/**
 * Typing a booking by hand (Réservations → Nouvelle saisie): a direct booking, a platform booking or an owner
 * block. Validation and every rule are the server's (lib/admin/booking-form.ts, lib/server/admin/bookings.ts); the
 * price shown under a direct booking is computed with the same function the server uses (directAmounts).
 */
export function EntryForm({
  kind,
  action,
  listings,
  initial,
}: {
  kind: EntryKind;
  action: (prev: EntryState, form: FormData) => Promise<EntryState>;
  listings: EntryListing[];
  initial: EntryValues;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const values = state.values ?? initial;
  const errors = state.fieldErrors ?? {};
  return (
    <form action={formAction} noValidate className="space-y-6" aria-describedby={state.error ? "entry-error" : undefined} data-testid="entry-form" data-kind={kind}>
      {state.error && (
        <div id="entry-error" role="alert" className="rounded-lg border border-error bg-[#fdecea] p-4 text-error">
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
      <Fields key={JSON.stringify(values)} kind={kind} listings={listings} values={values} errors={errors} />
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Link href="/admin/reservations" className="inline-flex h-12 items-center justify-center rounded-sm px-6 font-semibold underline underline-offset-2">
          Annuler
        </Link>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Enregistrement…" : SUBMIT[kind]}
        </Button>
      </div>
    </form>
  );
}

function Fields({ kind, listings, values, errors }: { kind: EntryKind; listings: EntryListing[]; values: EntryValues; errors: EntryFieldErrors }) {
  const v = (k: EntryFieldName) => values[k] ?? "";
  const [listingId, setListingId] = useState(v("listingId"));
  const [checkIn, setCheckIn] = useState(v("checkIn"));
  const [checkOut, setCheckOut] = useState(v("checkOut"));
  const [nightly, setNightly] = useState(v("nightly"));
  const [cleaning, setCleaning] = useState(v("cleaning"));
  const listing = listings.find((l) => l.id === listingId);
  const from = parseDay(checkIn);
  const to = parseDay(checkOut);
  const nights = from && to && to > from ? daysBetween(from, to) : 0;

  return (
    <div className="space-y-6">
      <Section title={kind === "blocage" ? "Bien et dates bloquées" : "Bien et séjour"}>
        <Field name="listingId" label="Bien" error={errors.listingId} className="sm:col-span-2">
          {(p) => (
            <select {...p} name="listingId" required value={listingId} onChange={(e) => setListingId(e.target.value)} className={input}>
              <option value="">Choisir…</option>
              {listings.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title} — {l.address}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field name="checkIn" label="Arrivée" error={errors.checkIn}>
          {(p) => <input {...p} type="date" name="checkIn" required value={checkIn} onChange={(e) => setCheckIn(e.target.value)} className={input} />}
        </Field>
        <Field name="checkOut" label="Départ" error={errors.checkOut} hint={nights > 0 ? pluralize(nights, "nuit", "nuits") : undefined}>
          {(p) => <input {...p} type="date" name="checkOut" required value={checkOut} min={checkIn || undefined} onChange={(e) => setCheckOut(e.target.value)} className={input} />}
        </Field>
        {listing && kind !== "blocage" && (
          <p className="text-caption text-ink-muted sm:col-span-2" data-testid="listing-rules">
            {pluralize(listing.maxGuests, "voyageur", "voyageurs")} au maximum · séjour minimum {pluralize(listing.minNights, "nuit", "nuits")} · {formatPrice(listing.priceCents)} / nuit · ménage{" "}
            {formatPrice(listing.cleaningFeeCents)}
          </p>
        )}
      </Section>

      {kind === "plateforme" && (
        <Section title="Plateforme" intro="La référence est le code de la réservation sur la plateforme (code de confirmation Airbnb, numéro Booking.com…). Elle évite les doublons quand la synchronisation l'importera.">
          <Field name="source" label="Plateforme" error={errors.source}>
            {(p) => (
              <select {...p} name="source" required defaultValue={v("source")} className={input}>
                <option value="">Choisir…</option>
                {PLATFORM_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {SOURCE_LABEL[s]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field name="externalRef" label="Référence de la plateforme" error={errors.externalRef}>
            {(p) => <input {...p} name="externalRef" required maxLength={ENTRY_LIMITS.externalRef} defaultValue={v("externalRef")} autoComplete="off" className={input} />}
          </Field>
        </Section>
      )}

      {kind !== "blocage" && (
        <Section title="Voyageur" intro={kind === "directe" ? "Pas besoin de compte : le nom et un moyen de contact suffisent." : "Tel que la plateforme le communique (facultatif)."}>
          <Field name="guestName" label="Nom du voyageur" error={errors.guestName} className="sm:col-span-2">
            {(p) => <input {...p} name="guestName" required={kind === "directe"} maxLength={ENTRY_LIMITS.name} defaultValue={v("guestName")} autoComplete="off" className={input} />}
          </Field>
          <Field name="guestPhone" label="Téléphone" hint="Avec l'indicatif, ex. +212 6 12 34 56 78" error={errors.guestPhone}>
            {(p) => <input {...p} type="tel" name="guestPhone" maxLength={ENTRY_LIMITS.phone} defaultValue={v("guestPhone")} autoComplete="off" className={input} />}
          </Field>
          <Field name="guestEmail" label="E-mail" error={errors.guestEmail}>
            {(p) => <input {...p} type="email" name="guestEmail" maxLength={ENTRY_LIMITS.email} defaultValue={v("guestEmail")} autoComplete="off" className={input} />}
          </Field>
          <div className="grid grid-cols-2 gap-4 sm:col-span-2 sm:grid-cols-4">
            <Field name="adults" label="Adultes" error={errors.adults}>
              {(p) => <input {...p} name="adults" inputMode="numeric" required defaultValue={v("adults") || "1"} className={input} />}
            </Field>
            <Field name="children" label="Enfants" error={errors.children}>
              {(p) => <input {...p} name="children" inputMode="numeric" defaultValue={v("children") || "0"} className={input} />}
            </Field>
            <Field name="infants" label="Bébés" error={errors.infants}>
              {(p) => <input {...p} name="infants" inputMode="numeric" defaultValue={v("infants") || "0"} className={input} />}
            </Field>
            <Field name="pets" label="Animaux" error={errors.pets}>
              {(p) => <input {...p} name="pets" inputMode="numeric" defaultValue={v("pets") || "0"} className={input} />}
            </Field>
          </div>
          {kind === "directe" && (
            <Field name="channel" label="Reçue par" error={errors.channel}>
              {(p) => (
                <select {...p} name="channel" required defaultValue={v("channel") || "PHONE"} className={input}>
                  {CHANNELS.map((c) => (
                    <option key={c} value={c}>
                      {CHANNEL_LABEL[c]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
        </Section>
      )}

      {kind === "directe" && (
        <Section title="Prix" intro="Laissez vide pour appliquer le prix du bien. Montants en dirhams (MAD).">
          <Field name="nightly" label="Prix par nuit (MAD)" error={errors.nightly}>
            {(p) => (
              <input
                {...p}
                name="nightly"
                inputMode="decimal"
                placeholder={listing ? centimesToDirhams(listing.priceCents) : undefined}
                value={nightly}
                onChange={(e) => setNightly(e.target.value)}
                className={input}
              />
            )}
          </Field>
          <Field name="cleaning" label="Frais de ménage (MAD)" error={errors.cleaning}>
            {(p) => (
              <input
                {...p}
                name="cleaning"
                inputMode="decimal"
                placeholder={listing ? centimesToDirhams(listing.cleaningFeeCents) : undefined}
                value={cleaning}
                onChange={(e) => setCleaning(e.target.value)}
                className={input}
              />
            )}
          </Field>
          <DirectPreview listing={listing} nights={nights} nightly={nightly} cleaning={cleaning} />
          <label className="flex items-start gap-3 sm:col-span-2">
            <input type="checkbox" name="allowShortStay" defaultChecked={v("allowShortStay") === "on"} className="mt-1 size-4 accent-brand" />
            <span>
              Accepter un séjour plus court que le minimum du bien
              <span className="block text-caption text-ink-muted">Exception décidée par l&apos;équipe ; elle est notée dans l&apos;historique.</span>
            </span>
          </label>
        </Section>
      )}

      {kind === "plateforme" && (
        <Section title="Montant" intro="Facultatif : le montant de la confirmation de la plateforme, s'il est connu. Sinon il sera complété plus tard.">
          <Field name="total" label="Montant total (MAD)" error={errors.total}>
            {(p) => <input {...p} name="total" inputMode="decimal" defaultValue={v("total")} className={input} />}
          </Field>
          <Field name="cleaning" label="Dont frais de ménage (MAD)" error={errors.cleaning}>
            {(p) => <input {...p} name="cleaning" inputMode="decimal" defaultValue={v("cleaning")} className={input} />}
          </Field>
        </Section>
      )}

      <Section title={kind === "blocage" ? "Motif" : "Note interne"} intro={kind === "blocage" ? "Ex. « Séjour du propriétaire et de sa famille ». Aucun voyageur ni montant : les dates sont seulement fermées à la réservation." : "Visible par l'équipe seulement."}>
        <Field name="note" label={kind === "blocage" ? "Motif du blocage" : "Note"} error={errors.note} className="sm:col-span-2">
          {(p) => <textarea {...p} name="note" rows={3} required={kind === "blocage"} maxLength={ENTRY_LIMITS.note} defaultValue={v("note")} className={area} />}
        </Field>
      </Section>
    </div>
  );
}

/** The price as the server will compute it, or what is missing to compute it. */
function DirectPreview({ listing, nights, nightly, cleaning }: { listing?: EntryListing; nights: number; nightly: string; cleaning: string }) {
  if (!listing || nights === 0) {
    return <p className="text-ink-muted sm:col-span-2">Choisissez le bien et les dates pour voir le prix.</p>;
  }
  const n = nightly.trim() === "" ? null : dirhamsToCentimes(nightly);
  const c = cleaning.trim() === "" ? null : dirhamsToCentimes(cleaning);
  if ((nightly.trim() !== "" && n === null) || (cleaning.trim() !== "" && c === null)) {
    return <p className="text-error sm:col-span-2">Montant en dirhams attendu (ex. 1200 ou 1200,50).</p>;
  }
  const a = directAmounts(listing, nights, { nightlyCents: n, cleaningFeeCents: c });
  return (
    <div className="rounded-sm bg-surface-2 p-3 sm:col-span-2" aria-live="polite" data-testid="price-preview">
      <p>
        {pluralize(nights, "nuit", "nuits")} × {formatPrice(a.nightlyCents)} + ménage {formatPrice(a.cleaningFeeCents)} ={" "}
        <strong data-testid="price-total">{formatPrice(a.totalCents)}</strong>
      </p>
      {nights < listing.minNights && (
        <p className="mt-1 font-medium text-error">
          Plus court que le séjour minimum du bien ({pluralize(listing.minNights, "nuit", "nuits")}) : cochez la case ci-dessous pour l&apos;accepter.
        </p>
      )}
    </div>
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
