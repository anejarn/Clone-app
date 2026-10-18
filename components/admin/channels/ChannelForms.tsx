"use client";

import { Link2, RefreshCw, Trash2 } from "lucide-react";
import { useActionState, useId, useState, useTransition } from "react";
import {
  issueExportLinkAction,
  removeImportUrlAction,
  revokeExportLinkAction,
  saveBookingRulesAction,
  setImportUrlAction,
  syncNowAction,
  type ChannelFormState,
} from "@/app/admin/biens/channel-actions";
import { resolveConflictAction } from "@/app/admin/synchronisation/actions";
import { CopyButton } from "@/components/guide/CopyButton";
import { Button } from "@/components/ui/Button";

/** Back-office forms of the calendar synchronisation (Lot 7). The server actions re-check everything. */

const input =
  "h-11 w-full rounded-sm border border-ink-faint bg-white px-3 text-body outline-none focus:border-ink focus:ring-1 focus:ring-ink aria-[invalid=true]:border-error";

function Feedback({ state }: { state: ChannelFormState }) {
  return (
    <>
      {state.error && (
        <p role="alert" className="rounded-sm border border-error bg-[#fdecea] p-3 text-error">
          {state.error}
        </p>
      )}
      {state.warning && (
        <p role="status" className="rounded-sm border border-[#8a5a00] bg-[#fff6e0] p-3 text-[#5c3c00]">
          {state.warning}
        </p>
      )}
      {state.message && (
        <p role="status" className="rounded-sm bg-brand-tint p-3 font-medium text-brand-deep">
          {state.message}
        </p>
      )}
    </>
  );
}

function useAction() {
  const [state, setState] = useState<ChannelFormState>({});
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ChannelFormState>) => start(async () => setState(await fn()));
  return { state, pending, run };
}

export interface FeedCardProps {
  listingId: string;
  source: string;
  label: string;
  exportUrl: string | null;
  exportRevoked: boolean;
  importHost: string | null;
  importHint: string;
  exportHint: string;
  /** Already formatted on the server. */
  status: { tone: "ok" | "warn" | "error" | "none"; text: string };
}

export function FeedCard(p: FeedCardProps) {
  const id = useId();
  const { state, pending, run } = useAction();
  const [importState, saveImport, saving] = useActionState(setImportUrlAction.bind(null, p.listingId, p.source), {});
  const tone = { ok: "text-success", warn: "text-[#8a5a00]", error: "text-error", none: "text-ink-muted" }[p.status.tone];
  return (
    <section className="rounded-lg border border-line bg-white p-4 md:p-6" aria-labelledby={`${id}-t`} data-testid={`feed-${p.source}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`${id}-t`} className="text-title-s font-semibold">
          {p.label}
        </h2>
        <p className={`text-caption font-semibold ${tone}`} data-testid="feed-status">
          {p.status.text}
        </p>
      </div>

      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <div>
          <h3 className="font-semibold">Export Sigma → {p.label}</h3>
          <p className="mt-1 text-caption text-ink-muted">{p.exportHint} Ce lien est secret : il donne les dates occupées du bien, sans aucune donnée de voyageur.</p>
          {p.exportUrl ? (
            <div className="mt-3 space-y-2">
              <input className={input} readOnly value={p.exportUrl} aria-label={`Lien d'export ${p.label}`} data-testid="export-url" onFocus={(e) => e.currentTarget.select()} />
              <div className="flex flex-wrap gap-2">
                <CopyButton value={p.exportUrl} label="Copier le lien" copiedLabel="Lien copié" />
                <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => confirm("Régénérer ? L'ancien lien cessera de fonctionner : il faudra coller le nouveau sur la plateforme.") && run(() => issueExportLinkAction(p.listingId, p.source))}>
                  <RefreshCw className="size-4" aria-hidden="true" />
                  Régénérer
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => confirm("Révoquer ce lien ? La plateforme ne recevra plus les dates de Sigma.") && run(() => revokeExportLinkAction(p.listingId, p.source))}>
                  <Trash2 className="size-4" aria-hidden="true" />
                  Révoquer
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-3">
              {p.exportRevoked && <p className="mb-2 text-caption text-ink-muted">Lien révoqué.</p>}
              <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => run(() => issueExportLinkAction(p.listingId, p.source))}>
                <Link2 className="size-4" aria-hidden="true" />
                Créer le lien d&apos;export
              </Button>
            </div>
          )}
        </div>

        <div>
          <h3 className="font-semibold">Import {p.label} → Sigma</h3>
          <p className="mt-1 text-caption text-ink-muted">{p.importHint} Lu toutes les 10 minutes.</p>
          {p.importHost && (
            <p className="mt-2 text-body">
              Lien enregistré : <span className="font-semibold">{p.importHost}</span> (chiffré, jamais affiché en entier)
            </p>
          )}
          <form action={saveImport} className="mt-3 space-y-2">
            <label htmlFor={`${id}-url`} className="block text-caption font-semibold">
              {p.importHost ? "Remplacer le lien iCal" : "Lien iCal de la plateforme"}
            </label>
            <input id={`${id}-url`} name="url" type="url" required maxLength={2048} placeholder="https://…" className={input} autoComplete="off" />
            <Button type="submit" size="sm" disabled={saving}>
              Enregistrer le lien
            </Button>
          </form>
          {p.importHost && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" variant="primary" size="sm" disabled={pending} onClick={() => run(() => syncNowAction(p.listingId, p.source))}>
                <RefreshCw className={`size-4 ${pending ? "animate-spin" : ""}`} aria-hidden="true" />
                Synchroniser maintenant
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => confirm("Ne plus lire ce calendrier ? Les réservations déjà importées restent.") && run(() => removeImportUrlAction(p.listingId, p.source))}>
                Supprimer le lien
              </Button>
            </div>
          )}
          <div className="mt-3 space-y-2" aria-live="polite">
            <Feedback state={importState} />
          </div>
        </div>
      </div>
      <div className="mt-3 space-y-2" aria-live="polite">
        <Feedback state={state} />
      </div>
    </section>
  );
}

export function BookingRulesForm({ listingId, preparationDays, minNoticeDays }: { listingId: string; preparationDays: number; minNoticeDays: number }) {
  const [state, action, pending] = useActionState(saveBookingRulesAction.bind(null, listingId), {});
  return (
    <form action={action} className="rounded-lg border border-line bg-white p-4 md:p-6" aria-labelledby="rules-title">
      <h2 id="rules-title" className="text-title-s font-semibold">
        Protection contre les doubles réservations
      </h2>
      <p className="mt-1 text-ink-muted">
        Appliqués aux réservations du site et aux liens d&apos;export. <strong>À reporter dans les paramètres de chaque plateforme</strong> : iCal ne transmet aucune règle.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="block font-semibold">Délai de préparation (jours)</span>
          <span className="block text-caption text-ink-muted">Nuits laissées libres avant chaque arrivée et après chaque départ (0 à 7).</span>
          <input name="preparationDays" type="number" min={0} max={7} step={1} required defaultValue={preparationDays} className={`${input} mt-1`} />
        </label>
        <label className="block">
          <span className="block font-semibold">Préavis minimum (jours)</span>
          <span className="block text-caption text-ink-muted">1 = pas de réservation le jour même (0 à 30).</span>
          <input name="minNoticeDays" type="number" min={0} max={30} step={1} required defaultValue={minNoticeDays} className={`${input} mt-1`} />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          Enregistrer les règles
        </Button>
      </div>
      <div className="mt-3 space-y-2" aria-live="polite">
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function ConflictActions({ conflictId, canReplace }: { conflictId: string; canReplace: boolean }) {
  const { state, pending, run } = useAction();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {canReplace && (
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={pending}
            onClick={() => confirm("Annuler la réservation en place et garder la réservation importée ?") && run(() => resolveConflictAction(conflictId, "REPLACE"))}
          >
            Annuler la réservation en place et garder l&apos;import
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => run(() => resolveConflictAction(conflictId, "DISMISS"))}>
          Marquer comme traité
        </Button>
      </div>
      <div aria-live="polite">
        <Feedback state={state} />
      </div>
    </div>
  );
}
