"use client";

import { Camera, FileText, Pencil, Plus, Trash2, UserRound } from "lucide-react";
import { startTransition, useActionState, useId, useState, useTransition, type FormEvent, type ReactNode } from "react";
import {
  deleteTravelerAction,
  deleteTravelerDocumentAction,
  saveTravelerAction,
  uploadTravelerDocumentAction,
  type SimpleResult,
  type TravelerFormState,
} from "@/app/admin/declarations/actions";
import { compressPhoto } from "@/components/admin/tasks/compress";
import { Button } from "@/components/ui/Button";
import { DOCUMENT_TYPE_LABEL, DOCUMENT_TYPES, identityToValues, SEX_LABEL, SEXES, TRAVELER_LABEL, TRAVELER_LIMITS, travelerName } from "@/lib/declarations/traveler-form";
import type { TravelerIdentity } from "@/lib/declarations/traveler-form";

/**
 * Recording the travellers of a stay (fiches de police), on a phone first: the associés from Déclarations, the agent
 * from their welcome task. Each change is one server action (app/admin/declarations/actions.ts) that checks access,
 * the task window and the fields again; the page re-renders from the server. Document photos are shrunk on the phone,
 * then encrypted by the server before storage; only associés can open them (`canViewDocuments`).
 */

export type Scope = { bookingId: string } | { taskId: string };

export interface CaptureTraveler {
  id: string;
  identity: TravelerIdentity;
  isMinor: boolean;
  guardianId: string | null;
  guardianName: string | null;
  declaredAt: string | null;
  documents: { id: string; contentType: string }[];
}

const input =
  "h-11 w-full rounded-sm border border-ink-faint bg-white px-3 text-body-l outline-none focus:border-ink focus:ring-1 focus:ring-ink aria-[invalid=true]:border-error";
const card = "rounded-lg border border-line bg-white p-4 md:p-6";
const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";
const jjmmaaaa = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");

function Notice({ state }: { state: { error?: string; message?: string } }) {
  if (state.error) {
    return (
      <p role="alert" className="rounded-sm border border-error bg-[#fdecea] p-3 text-error">
        {state.error}
      </p>
    );
  }
  if (state.message) {
    return (
      <p role="status" className="rounded-sm bg-brand-tint p-3 font-medium text-brand-deep">
        {state.message}
      </p>
    );
  }
  return null;
}

function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: (p: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) => ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-micro font-medium">
        {label}
      </label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": error || hint ? `${id}-d` : undefined })}
      {(error || hint) && (
        <p id={`${id}-d`} className={`mt-1 text-caption ${error ? "text-error" : "text-ink-muted"}`}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

async function shrink(form: FormData, field: string) {
  const f = form.get(field);
  if (f instanceof File && f.size > 0 && f.type.startsWith("image/")) form.set(field, await compressPhoto(f));
  else if (f instanceof File && f.size === 0) form.delete(field);
}

function TravelerForm({
  scope,
  stay,
  traveler,
  adults,
  countries,
  onDone,
}: {
  scope: Scope;
  stay: { checkIn: string; checkOut: string };
  traveler: CaptureTraveler | null;
  adults: { id: string; name: string }[];
  countries: { code: string; name: string }[];
  onDone: (message: string) => void;
}) {
  const [state, dispatch, pending] = useActionState<TravelerFormState, FormData>(async (prev, form) => {
    const r = await saveTravelerAction(scope, traveler?.id ?? null, prev, form);
    if (r.saved && !r.error) onDone(r.message ?? "Enregistré.");
    return r;
  }, {});
  const initial = traveler ? identityToValues(traveler.identity, traveler.guardianId) : { arrivalDate: stay.checkIn, departureDate: stay.checkOut };
  const v = (k: string) => state.values?.[k] ?? (initial as Record<string, string>)[k] ?? "";
  const err = state.fieldErrors ?? {};
  const prefix = traveler ? "Modifier" : "Ajouter";

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(async () => {
      await shrink(form, "document");
      dispatch(form);
    });
  }

  const countrySelect = (name: keyof TravelerIdentity, required = false) => (
    <Field label={TRAVELER_LABEL[name] + (required ? "" : " (facultatif)")} error={err[name]}>
      {(p) => (
        <select {...p} name={name} defaultValue={v(name)} className={input}>
          <option value="">—</option>
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
  const text = (name: keyof TravelerIdentity, opts: { required?: boolean; max: number; autoComplete?: string; upper?: boolean }) => (
    <Field label={TRAVELER_LABEL[name] + (opts.required ? "" : " (facultatif)")} error={err[name]}>
      {(p) => <input {...p} name={name} defaultValue={v(name)} maxLength={opts.max} autoComplete={opts.autoComplete ?? "off"} className={`${input}${opts.upper ? " uppercase" : ""}`} />}
    </Field>
  );
  const date = (name: keyof TravelerIdentity, required = false) => (
    <Field label={TRAVELER_LABEL[name] + (required ? "" : " (facultatif)")} error={err[name]}>
      {(p) => <input {...p} name={name} type="date" defaultValue={v(name)} className={input} />}
    </Field>
  );

  return (
    <form onSubmit={submit} noValidate className={`${card} space-y-4`} data-testid="traveler-form" aria-label={`${prefix} un voyageur`}>
      <h3 className="text-title-s font-semibold">{traveler ? `Modifier la fiche de ${travelerName(traveler.identity)}` : "Nouveau voyageur"}</h3>
      <Notice state={state} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {text("lastName", { required: true, max: TRAVELER_LIMITS.name, upper: true })}
        {text("firstName", { required: true, max: TRAVELER_LIMITS.name })}
        <Field label={TRAVELER_LABEL.sex} error={err.sex}>
          {(p) => (
            <select {...p} name="sex" defaultValue={v("sex")} className={input}>
              <option value="">—</option>
              {SEXES.map((s) => (
                <option key={s} value={s}>
                  {SEX_LABEL[s]}
                </option>
              ))}
            </select>
          )}
        </Field>
        {date("birthDate", true)}
        {text("birthPlace", { max: TRAVELER_LIMITS.place })}
        {countrySelect("nationality", true)}
        <Field label={TRAVELER_LABEL.documentType} hint="Facultatif pour un mineur." error={err.documentType}>
          {(p) => (
            <select {...p} name="documentType" defaultValue={v("documentType")} className={input}>
              <option value="">—</option>
              {DOCUMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {DOCUMENT_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          )}
        </Field>
        {text("documentNumber", { required: true, max: TRAVELER_LIMITS.documentNumber, upper: true })}
        {date("documentIssueDate")}
        {countrySelect("documentIssueCountry")}
        {date("documentExpiryDate")}
        {countrySelect("residenceCountry")}
        <div className="sm:col-span-2">{text("address", { max: TRAVELER_LIMITS.address })}</div>
        {text("profession", { max: TRAVELER_LIMITS.profession })}
        {date("arrivalDate", true)}
        {date("departureDate", true)}
        {text("comingFrom", { max: TRAVELER_LIMITS.place })}
        {text("goingTo", { max: TRAVELER_LIMITS.place })}
        <Field label="Adulte accompagnant (pour un mineur)" hint="Un mineur (moins de 18 ans à l'arrivée) est rattaché à un adulte du séjour." error={err.guardianId}>
          {(p) => (
            <select {...p} name="guardianId" defaultValue={v("guardianId")} className={input}>
              <option value="">—</option>
              {adults
                .filter((a) => a.id !== traveler?.id)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          )}
        </Field>
        {!traveler && (
          <Field label="Photo de la pièce d'identité (facultatif)" hint="L'appareil photo s'ouvre sur un téléphone. JPEG, PNG, WebP ou PDF, 5 Mo au plus. Chiffrée avant d'être enregistrée.">
            {(p) => <input {...p} name="document" type="file" accept={ACCEPT} capture="environment" className="block w-full text-body file:mr-3 file:h-11 file:rounded-sm file:border file:border-ink file:bg-white file:px-4 file:font-semibold" />}
          </Field>
        )}
      </div>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Enregistrement…" : traveler ? "Enregistrer la fiche" : "Enregistrer le voyageur"}
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => onDone("")}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

export function TravelerCapture({
  scope,
  stay,
  travelers,
  countries,
  canViewDocuments,
  writable,
}: {
  scope: Scope;
  stay: { checkIn: string; checkOut: string; adults: number; children: number; infants: number };
  travelers: CaptureTraveler[];
  countries: { code: string; name: string }[];
  canViewDocuments: boolean;
  writable: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(travelers.length === 0 && writable ? "new" : null);
  const [feedback, setFeedback] = useState<SimpleResult>({});
  const [pending, start] = useTransition();
  const adults = travelers.filter((t) => !t.isMinor).map((t) => ({ id: t.id, name: travelerName(t.identity) }));
  const recordedAdults = adults.length;
  const country = (code: string | null) => countries.find((c) => c.code === code)?.name ?? code ?? "—";

  function run(fn: () => Promise<SimpleResult>) {
    setFeedback({});
    start(async () => setFeedback(await fn()));
  }

  function upload(travelerId: string, el: HTMLInputElement) {
    const file = el.files?.[0];
    if (!file) return;
    run(async () => {
      const form = new FormData();
      form.set("document", file.type.startsWith("image/") ? await compressPhoto(file) : file);
      const r = await uploadTravelerDocumentAction(scope, travelerId, form);
      el.value = "";
      return r;
    });
  }

  const done = (message: string) => {
    setEditing(null);
    if (message) setFeedback({ message });
  };

  return (
    <section aria-labelledby="travelers-title" className="space-y-4" data-testid="traveler-capture">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="travelers-title" className="text-title-m font-semibold">
          Voyageurs ({travelers.length})
        </h2>
        <p className="text-caption text-ink-muted" data-testid="traveler-counts">
          {recordedAdults} adulte{recordedAdults > 1 ? "s" : ""} enregistré{recordedAdults > 1 ? "s" : ""} sur {stay.adults} annoncé{stay.adults > 1 ? "s" : ""}
          {stay.children + stay.infants > 0 && ` · ${stay.children + stay.infants} mineur(s) annoncé(s), à enregistrer si besoin`}
        </p>
      </div>
      <div aria-live="polite">
        <Notice state={feedback} />
      </div>
      {travelers.length === 0 && editing !== "new" && <p className="rounded-lg border border-line bg-white p-4 text-ink-muted">Aucun voyageur enregistré.</p>}
      <ul className="space-y-3">
        {travelers.map((t) =>
          editing === t.id ? (
            <li key={t.id}>
              <TravelerForm scope={scope} stay={stay} traveler={t} adults={adults} countries={countries} onDone={done} />
            </li>
          ) : (
            <li key={t.id} className={card} data-testid="traveler-row" data-minor={t.isMinor} data-declared={!!t.declaredAt}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="flex items-center gap-2 text-body-l font-semibold">
                  <UserRound className="size-5 text-brand" aria-hidden="true" />
                  {travelerName(t.identity)}
                </p>
                <div className="flex flex-wrap gap-1.5 text-caption font-medium">
                  {t.isMinor && <span className="rounded-pill bg-surface-2 px-2.5 py-0.5">Mineur{t.guardianName ? ` · avec ${t.guardianName}` : ""}</span>}
                  <span className={`rounded-pill px-2.5 py-0.5 ${t.declaredAt ? "bg-brand-tint text-brand-deep" : "bg-[#fdecea] text-error"}`} data-testid="traveler-declared">
                    {t.declaredAt ? `Déclaré le ${jjmmaaaa(t.declaredAt)}` : "Non déclaré"}
                  </span>
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-body sm:grid-cols-2">
                <div>
                  <dt className="inline text-ink-muted">Né(e) le </dt>
                  <dd className="inline">{jjmmaaaa(t.identity.birthDate)}</dd>
                </div>
                <div>
                  <dt className="inline text-ink-muted">Nationalité : </dt>
                  <dd className="inline">{country(t.identity.nationality)}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="inline text-ink-muted">Pièce : </dt>
                  <dd className="inline">
                    {t.identity.documentType ? `${DOCUMENT_TYPE_LABEL[t.identity.documentType]} ${t.identity.documentNumber}` : "—"}
                  </dd>
                </div>
              </dl>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {t.documents.length > 0 && !canViewDocuments && (
                  <span className="text-caption font-medium text-success" data-testid="traveler-documents">
                    {t.documents.length} photo{t.documents.length > 1 ? "s" : ""} de la pièce enregistrée{t.documents.length > 1 ? "s" : ""}
                  </span>
                )}
                {canViewDocuments &&
                  t.documents.map((d, i) => (
                    <span key={d.id} className="inline-flex items-center gap-1">
                      <a
                        href={`/api/admin/declarations/documents/${d.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-10 items-center gap-1.5 rounded-sm border border-line px-3 font-medium underline-offset-2 hover:underline"
                        data-testid="traveler-document-link"
                      >
                        <FileText className="size-4" aria-hidden="true" />
                        Voir la pièce {i + 1}
                      </a>
                      {writable && (
                        <button
                          type="button"
                          className="grid size-10 place-items-center rounded-sm text-error hover:bg-surface-2"
                          aria-label={`Supprimer la pièce ${i + 1} de ${travelerName(t.identity)}`}
                          disabled={pending}
                          onClick={() => confirm("Supprimer cette photo ?") && run(() => deleteTravelerDocumentAction(scope, d.id))}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </button>
                      )}
                    </span>
                  ))}
              </div>
              {writable && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-sm border border-ink bg-white px-4 font-semibold hover:bg-surface-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink">
                    <Camera className="size-4" aria-hidden="true" />
                    Photographier la pièce
                    <input type="file" accept={ACCEPT} capture="environment" className="sr-only" aria-label={`Photo de la pièce de ${travelerName(t.identity)}`} disabled={pending} onChange={(e) => upload(t.id, e.currentTarget)} />
                  </label>
                  <Button type="button" variant="outline" size="sm" onClick={() => setEditing(t.id)} disabled={pending}>
                    <Pencil className="size-4" aria-hidden="true" />
                    Modifier
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-error"
                    disabled={pending}
                    onClick={() => confirm(`Supprimer la fiche de ${travelerName(t.identity)} ?`) && run(() => deleteTravelerAction(scope, t.id))}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                    Supprimer
                  </Button>
                </div>
              )}
            </li>
          ),
        )}
      </ul>
      {writable &&
        (editing === "new" ? (
          <TravelerForm scope={scope} stay={stay} traveler={null} adults={adults} countries={countries} onDone={done} />
        ) : (
          <Button type="button" variant="primary" onClick={() => setEditing("new")} disabled={pending}>
            <Plus className="size-4" aria-hidden="true" />
            Ajouter un voyageur
          </Button>
        ))}
    </section>
  );
}
