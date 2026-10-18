"use client";

import { Check, Mail, RefreshCw, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useActionState, useId, useState, useTransition } from "react";
import {
  applyEmailAction,
  createBookingFromEmailAction,
  dropEmailAction,
  ignoreEmailAction,
  issueInboundAddressAction,
  markPriceReminderDoneAction,
  revokeInboundAddressAction,
  type EmailActionState,
} from "@/app/admin/synchronisation/email-actions";
import { CopyButton } from "@/components/guide/CopyButton";
import { Button } from "@/components/ui/Button";

/** Back-office forms of the booking e-mails and price reminders (Lot 7b). The server actions re-check everything. */

const input =
  "h-11 w-full rounded-sm border border-ink-faint bg-white px-3 text-body outline-none focus:border-ink focus:ring-1 focus:ring-ink aria-[invalid=true]:border-error";

function Feedback({ state }: { state: EmailActionState }) {
  return (
    <>
      {state.error && (
        <p role="alert" className="rounded-sm border border-error bg-[#fdecea] p-3 text-error">
          {state.error}
        </p>
      )}
      {state.message && (
        <p role="status" className="rounded-sm bg-brand-tint p-3 font-medium text-brand-deep">
          {state.message}
          {state.bookingId && (
            <>
              {" "}
              <Link href={`/admin/reservations/${state.bookingId}`} className="underline underline-offset-2">
                Voir la réservation
              </Link>
            </>
          )}
        </p>
      )}
    </>
  );
}

function useAction() {
  const [state, setState] = useState<EmailActionState>({});
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<EmailActionState>) => start(async () => setState(await fn()));
  return { state, pending, run };
}

export function DropEmailForm() {
  const id = useId();
  const [state, action, pending] = useActionState(dropEmailAction, {});
  return (
    <form action={action} className="rounded-lg border border-line bg-white p-4 md:p-6" aria-labelledby={`${id}-t`} data-testid="drop-email">
      <h2 id={`${id}-t`} className="flex items-center gap-2 text-title-s font-semibold">
        <Upload className="size-5" aria-hidden="true" />
        Déposer un e-mail
      </h2>
      <p className="mt-1 text-ink-muted">
        En attendant le service de réception : enregistrez l&apos;e-mail de réservation (« Télécharger le message » / « Enregistrer sous… » en .eml dans votre messagerie) ou collez-le en
        entier, en-têtes compris (« Afficher l&apos;original »). Il est traité comme un e-mail reçu : les dates sont bloquées tout de suite.
      </p>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <label className="block">
          <span className="block font-semibold">Fichier .eml</span>
          <input name="eml" type="file" accept=".eml,message/rfc822,text/plain" className="mt-1 block w-full text-body file:mr-3 file:rounded-sm file:border file:border-ink file:bg-white file:px-3 file:py-2 file:font-semibold" />
        </label>
        <label className="block">
          <span className="block font-semibold">Ou le message collé</span>
          <textarea name="raw" rows={4} maxLength={5_000_000} className="mt-1 w-full rounded-sm border border-ink-faint bg-white p-3 font-mono text-caption outline-none focus:border-ink focus:ring-1 focus:ring-ink" placeholder="From: …&#10;Subject: …&#10;&#10;…" />
        </label>
      </div>
      <div className="mt-4">
        <Button type="submit" size="sm" disabled={pending}>
          <Mail className="size-4" aria-hidden="true" />
          Traiter l&apos;e-mail
        </Button>
      </div>
      <div className="mt-3 space-y-2" aria-live="polite">
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function InboundAddressActions({ url }: { url: string | null }) {
  const { state, pending, run } = useAction();
  return (
    <div className="space-y-2">
      {url ? (
        <>
          <input className={input} readOnly value={url} aria-label="Adresse de réception (webhook)" data-testid="inbound-url" onFocus={(e) => e.currentTarget.select()} />
          <div className="flex flex-wrap gap-2">
            <CopyButton value={url} label="Copier l'adresse" copiedLabel="Adresse copiée" />
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => confirm("Régénérer ? L'ancienne adresse cessera de fonctionner.") && run(issueInboundAddressAction)}>
              <RefreshCw className="size-4" aria-hidden="true" />
              Régénérer
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => confirm("Révoquer l'adresse ? Plus aucun e-mail ne sera accepté.") && run(revokeInboundAddressAction)}>
              <Trash2 className="size-4" aria-hidden="true" />
              Révoquer
            </Button>
          </div>
        </>
      ) : (
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => run(issueInboundAddressAction)}>
          Créer l&apos;adresse de réception
        </Button>
      )}
      <div aria-live="polite">
        <Feedback state={state} />
      </div>
    </div>
  );
}

export interface QueueDefaults {
  listingId: string;
  source: string;
  externalRef: string;
  checkIn: string;
  checkOut: string;
  guestName: string;
  adults: string;
  children: string;
  total: string;
}

export function EmailQueueActions({
  emailId,
  listings,
  candidates,
  defaults,
  canRemember,
  sources,
}: {
  emailId: string;
  listings: { id: string; title: string }[];
  candidates: string[];
  defaults: QueueDefaults;
  canRemember: boolean;
  sources: { value: string; label: string }[];
}) {
  const id = useId();
  const [applyState, apply, applying] = useActionState(applyEmailAction.bind(null, emailId), {});
  const [createState, create, creating] = useActionState(createBookingFromEmailAction.bind(null, emailId), {});
  const { state, pending, run } = useAction();
  const v = createState.values ?? {};
  const val = (k: keyof QueueDefaults) => (v as Record<string, string | undefined>)[k] ?? defaults[k];
  const err = (k: string) => (createState.fieldErrors as Record<string, string | undefined> | undefined)?.[k];
  const ordered = [...listings].sort((a, b) => Number(candidates.includes(b.id)) - Number(candidates.includes(a.id)));
  return (
    <div className="mt-3 space-y-3">
      <form action={apply} className="flex flex-col gap-2 rounded-sm border border-line p-3 md:flex-row md:items-end" aria-label="Rattacher à un bien et appliquer">
        <label className="block grow">
          <span className="block text-caption font-semibold">Bien concerné</span>
          <select name="listingId" defaultValue={defaults.listingId} className={`${input} mt-1`} aria-label="Bien concerné">
            <option value="">(celui que l&apos;e-mail indique)</option>
            {ordered.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title}
                {candidates.includes(l.id) ? " (proposé)" : ""}
              </option>
            ))}
          </select>
        </label>
        {canRemember && (
          <label className="flex items-center gap-2 text-caption md:pb-3">
            <input type="checkbox" name="remember" defaultChecked className="size-4" />
            Mémoriser ce bien pour les prochains e-mails
          </label>
        )}
        <Button type="submit" size="sm" disabled={applying}>
          <Check className="size-4" aria-hidden="true" />
          Appliquer l&apos;e-mail
        </Button>
      </form>
      <div aria-live="polite">
        <Feedback state={applyState} />
      </div>

      <details className="rounded-sm border border-line p-3">
        <summary className="cursor-pointer font-semibold">Créer la réservation à la main</summary>
        <form action={create} className="mt-3 grid gap-3 sm:grid-cols-2" aria-label="Créer la réservation à la main">
          <label className="block">
            <span className="block text-caption font-semibold">Bien</span>
            <select name="listingId" required defaultValue={val("listingId")} className={`${input} mt-1`} aria-invalid={!!err("listingId")}>
              <option value="">Choisir…</option>
              {ordered.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-caption font-semibold">Plateforme</span>
            <select name="source" required defaultValue={val("source")} className={`${input} mt-1`} aria-invalid={!!err("source")}>
              <option value="">Choisir…</option>
              {sources.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          {(
            [
              ["externalRef", "Référence de la plateforme", "text"],
              ["guestName", "Nom du voyageur", "text"],
              ["checkIn", "Arrivée", "date"],
              ["checkOut", "Départ", "date"],
              ["adults", "Adultes", "number"],
              ["children", "Enfants", "number"],
              ["total", "Montant total (MAD, facultatif)", "text"],
            ] as const
          ).map(([name, label, type]) => (
            <label key={name} className="block">
              <span className="block text-caption font-semibold">{label}</span>
              <input name={name} type={type} defaultValue={val(name)} className={`${input} mt-1`} aria-invalid={!!err(name)} {...(type === "number" && { min: 0, max: 50 })} />
              {err(name) && <span className="mt-1 block text-caption text-error">{err(name)}</span>}
            </label>
          ))}
          <input type="hidden" name="infants" value="0" />
          <input type="hidden" name="pets" value="0" />
          <div className="sm:col-span-2">
            <Button type="submit" size="sm" variant="outline" disabled={creating}>
              Créer la réservation
            </Button>
          </div>
        </form>
        <div className="mt-2" aria-live="polite">
          <Feedback state={createState} />
        </div>
      </details>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => run(() => ignoreEmailAction(emailId))} aria-describedby={`${id}-ign`}>
          Ignorer
        </Button>
        <span id={`${id}-ign`} className="self-center text-caption text-ink-muted">
          Pas une réservation, ou déjà saisie.
        </span>
      </div>
      <div aria-live="polite">
        <Feedback state={state} />
      </div>
    </div>
  );
}

export function PriceReminderDone({ reminderId, label }: { reminderId: string; label: string }) {
  const { state, pending, run } = useAction();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="primary" disabled={pending} onClick={() => run(() => markPriceReminderDoneAction(reminderId))} aria-label={`Fait sur ${label}`}>
        <Check className="size-4" aria-hidden="true" />
        Fait
      </Button>
      <span aria-live="polite">{state.error && <span className="text-error">{state.error}</span>}</span>
    </div>
  );
}
