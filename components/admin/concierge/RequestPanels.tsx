"use client";

import { Mail, MessageCircle, Phone } from "lucide-react";
import { useActionState, useId, useState, useTransition } from "react";
import {
  cancelPaymentAction,
  markSentAction,
  recordPaymentAction,
  setFinalPriceAction,
  setInternalNoteAction,
  setRequestStatusAction,
  type RequestActionState,
} from "@/app/admin/conciergerie/demandes/actions";
import { Feedback } from "@/components/admin/guide/GuideForms";
import { PAYMENT_METHOD_LABEL, PAYMENT_METHODS, REQUEST_STATUS_LABEL } from "@/lib/concierge/catalog";
import { CONCIERGE_LIMITS } from "@/lib/concierge/form";
import type { PartnerChannel, ServiceRequestStatus } from "@/lib/generated/prisma/enums";
import { centimesToDirhams } from "@/lib/money";

/** Back-office panels of a guest's service request (Conciergerie → Demandes → une demande). Actions re-check everything. */

const input =
  "h-11 w-full rounded-sm border border-ink-faint bg-white px-3 text-body-l outline-none focus:border-ink focus:ring-1 focus:ring-ink aria-[invalid=true]:border-error";
const card = "rounded-lg border border-line bg-white p-4 md:p-6";

function useRun() {
  const [pending, start] = useTransition();
  const [state, setState] = useState<RequestActionState>({});
  return { pending, state, run: (fn: () => Promise<RequestActionState>) => start(async () => setState(await fn())) };
}

/**
 * « Envoyer au partenaire »: the prefilled message, its WhatsApp / e-mail / phone links (opened from the associé's own
 * phone or mailbox: no provider is chosen yet), and « Marquer comme transmise » once sent. Opening a link marks it too.
 */
export function SendToPartner(props: {
  requestId: string;
  partnerName: string;
  preferred: PartnerChannel;
  text: string;
  whatsapp: string | null;
  mailto: string | null;
  tel: string | null;
  canSend: boolean;
  sentVia: PartnerChannel | null;
}) {
  const { pending, state, run } = useRun();
  const textId = useId();
  const links: { via: PartnerChannel; href: string | null; label: string; icon: typeof Mail }[] = [
    { via: "WHATSAPP", href: props.whatsapp, label: "Ouvrir WhatsApp", icon: MessageCircle },
    { via: "EMAIL", href: props.mailto, label: "Ouvrir l'e-mail", icon: Mail },
    { via: "PHONE", href: props.tel, label: "Appeler", icon: Phone },
  ];
  const available = links.filter((l) => l.href).sort((a, b) => Number(b.via === props.preferred) - Number(a.via === props.preferred));
  return (
    <section className={`${card} space-y-3`} aria-labelledby="send-title" data-testid="send-to-partner">
      <h2 id="send-title" className="text-title-s font-semibold">
        Envoyer au partenaire : {props.partnerName}
      </h2>
      <Feedback state={state} />
      {!props.canSend ? (
        <p className="text-ink-muted">Cette demande n&apos;est plus à transmettre.</p>
      ) : (
        <>
          <p className="text-caption text-ink-muted">
            Aucun fournisseur WhatsApp ou e-mail n&apos;est encore branché : ouvrez le lien, envoyez le message depuis votre téléphone ou votre messagerie, puis marquez la demande comme transmise.
          </p>
          <label htmlFor={textId} className="block text-micro font-medium">
            Message prérempli
          </label>
          <textarea id={textId} readOnly value={props.text} rows={10} className="w-full rounded-sm border border-line bg-surface-2 p-3 font-mono text-caption" data-testid="partner-message" />
          <div className="flex flex-wrap gap-2">
            {available.map((l) => (
              <a
                key={l.via}
                href={l.href!}
                target={l.via === "WHATSAPP" ? "_blank" : undefined}
                rel="noreferrer noopener"
                onClick={() => run(() => markSentAction(props.requestId, l.via))}
                className={`inline-flex h-11 items-center gap-2 rounded-sm px-4 font-semibold ${l.via === props.preferred ? "bg-brand text-white hover:bg-brand-strong" : "border border-ink bg-white text-ink hover:bg-surface-2"}`}
              >
                <l.icon className="size-4" aria-hidden="true" />
                {l.label}
              </a>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 border-t border-line-soft pt-3">
            {available.map((l) => (
              <button
                key={l.via}
                type="button"
                disabled={pending}
                onClick={() => run(() => markSentAction(props.requestId, l.via))}
                className="inline-flex h-10 items-center rounded-sm border border-ink bg-white px-4 font-semibold text-ink hover:bg-surface-2 disabled:opacity-60"
              >
                Marquer comme transmise ({l.via === "WHATSAPP" ? "WhatsApp" : l.via === "EMAIL" ? "e-mail" : "téléphone"})
              </button>
            ))}
          </div>
          {available.length === 0 && <p className="text-error">Ce partenaire n&apos;a aucun contact : complétez sa fiche.</p>}
        </>
      )}
    </section>
  );
}

const MOVE_LABEL: Partial<Record<ServiceRequestStatus, string>> = {
  CONFIRMED: "Confirmer (le partenaire a accepté)",
  DONE: "Marquer comme réalisée",
  REFUSED: "Refuser (pas disponible)",
  CANCELLED: "Annuler la demande",
};

export function StatusButtons({ requestId, moves }: { requestId: string; moves: ServiceRequestStatus[] }) {
  const { pending, state, run } = useRun();
  if (moves.length === 0) return null;
  return (
    <section className={`${card} space-y-3`} aria-labelledby="status-title">
      <h2 id="status-title" className="text-title-s font-semibold">
        Statut
      </h2>
      <Feedback state={state} />
      <div className="flex flex-wrap gap-2">
        {moves.map((to) => (
          <button
            key={to}
            type="button"
            disabled={pending}
            onClick={() => {
              if ((to === "CANCELLED" || to === "REFUSED") && !window.confirm(`${REQUEST_STATUS_LABEL[to]} : confirmer ?`)) return;
              run(() => setRequestStatusAction(requestId, to));
            }}
            className={`inline-flex h-11 items-center rounded-sm px-4 font-semibold disabled:opacity-60 ${to === "CONFIRMED" || to === "DONE" ? "bg-brand text-white hover:bg-brand-strong" : "border border-ink bg-white text-ink hover:bg-surface-2"}`}
          >
            {MOVE_LABEL[to] ?? REQUEST_STATUS_LABEL[to]}
          </button>
        ))}
      </div>
    </section>
  );
}

export function FinalPriceForm({ requestId, saleTotalCents, partnerTotalCents }: { requestId: string; saleTotalCents: number | null; partnerTotalCents: number | null }) {
  const [state, action, pending] = useActionState<RequestActionState, FormData>(setFinalPriceAction.bind(null, requestId), {});
  const saleId = useId();
  const partnerId = useId();
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} noValidate className={`${card} space-y-3`} data-testid="final-price-form">
      <h2 className="text-title-s font-semibold">Prix final</h2>
      <p className="text-caption text-ink-muted">Pour un devis ou un prix convenu avec le voyageur, avant de confirmer. La modification est enregistrée dans le journal.</p>
      <Feedback state={state} />
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor={saleId} className="mb-1 block text-micro font-medium">
            Prix de vente total (MAD)
          </label>
          <input id={saleId} name="saleTotal" inputMode="decimal" aria-invalid={e.saleTotal ? true : undefined} defaultValue={state.values?.saleTotal ?? (saleTotalCents === null ? "" : centimesToDirhams(saleTotalCents))} className={input} />
          {e.saleTotal && <p className="mt-1 text-caption text-error">{e.saleTotal}</p>}
        </div>
        <div>
          <label htmlFor={partnerId} className="mb-1 block text-micro font-medium">
            Prix partenaire total (MAD)
          </label>
          <input id={partnerId} name="partnerTotal" inputMode="decimal" aria-invalid={e.partnerTotal ? true : undefined} defaultValue={state.values?.partnerTotal ?? (partnerTotalCents === null ? "" : centimesToDirhams(partnerTotalCents))} className={input} />
          {e.partnerTotal && <p className="mt-1 text-caption text-error">{e.partnerTotal}</p>}
        </div>
      </div>
      <button type="submit" disabled={pending} className="inline-flex h-10 items-center rounded-sm bg-ink px-4 font-semibold text-white hover:bg-black disabled:opacity-60">
        Enregistrer le prix final
      </button>
    </form>
  );
}

export function PaymentForm({ requestId, canRecord, canCancel }: { requestId: string; canRecord: boolean; canCancel: boolean }) {
  const [state, action, pending] = useActionState<RequestActionState, FormData>(recordPaymentAction.bind(null, requestId), {});
  const cancel = useRun();
  const id = useId();
  return (
    <section className={`${card} space-y-3`} aria-labelledby="payment-title" data-testid="payment-form">
      <h2 id="payment-title" className="text-title-s font-semibold">
        Paiement
      </h2>
      <p className="text-caption text-ink-muted">Paiement sur place ou à la conciergerie (le paiement en ligne viendra en V2). Les espèces sont enregistrées pour la traçabilité.</p>
      <Feedback state={cancel.state.error || cancel.state.message ? cancel.state : state} />
      {canRecord && (
        <form action={action} className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor={id} className="mb-1 block text-micro font-medium">
              Moyen de paiement
            </label>
            <select id={id} name="method" defaultValue="CASH" className={input}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABEL[m]}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" disabled={pending} className="inline-flex h-11 items-center rounded-sm bg-brand px-4 font-semibold text-white hover:bg-brand-strong disabled:opacity-60">
            Enregistrer le paiement
          </button>
        </form>
      )}
      {canCancel && (
        <button
          type="button"
          disabled={cancel.pending}
          onClick={() => {
            if (window.confirm("Retirer le paiement enregistré (erreur ou remboursement) ?")) cancel.run(() => cancelPaymentAction(requestId));
          }}
          className="inline-flex h-10 items-center rounded-sm border border-ink bg-white px-4 font-semibold text-ink hover:bg-surface-2"
        >
          Retirer le paiement
        </button>
      )}
      {!canRecord && !canCancel && <p className="text-ink-muted">Le paiement s&apos;enregistre une fois la demande confirmée.</p>}
    </section>
  );
}

export function InternalNoteForm({ requestId, note }: { requestId: string; note: string }) {
  const [state, action, pending] = useActionState<RequestActionState, FormData>(setInternalNoteAction.bind(null, requestId), {});
  const id = useId();
  return (
    <form action={action} className={`${card} space-y-3`}>
      <label htmlFor={id} className="block text-title-s font-semibold">
        Note interne
      </label>
      <Feedback state={state} />
      <textarea id={id} name="internalNote" rows={3} maxLength={CONCIERGE_LIMITS.internalNote} defaultValue={note} className="w-full rounded-sm border border-ink-faint bg-white px-3 py-2" />
      <button type="submit" disabled={pending} className="inline-flex h-10 items-center rounded-sm bg-ink px-4 font-semibold text-white hover:bg-black disabled:opacity-60">
        Enregistrer la note
      </button>
    </form>
  );
}
