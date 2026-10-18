"use client";

import { CheckCircle2, Circle } from "lucide-react";
import { useActionState, useId, useState, useTransition } from "react";
import { saveListingMappingAction, setSetupTickAction, type ChannelFormState } from "@/app/admin/biens/channel-actions";
import { Button } from "@/components/ui/Button";
import type { ChecklistItem, PlatformGuide } from "@/lib/channels/guides";

/**
 * Biens → a home → Plateformes, per platform (Lot 7b): the step-by-step connection guide (generic wording, « à
 * vérifier sur l'interface actuelle »), its checklist (seen by Sigma or ticked by hand) and the platform's names of
 * the home used to recognize its booking e-mails.
 */

const input =
  "h-11 w-full rounded-sm border border-ink-faint bg-white px-3 text-body outline-none focus:border-ink focus:ring-1 focus:ring-ink";

function Steps({ title, steps }: { title: string; steps: string[] }) {
  if (!steps.length) return null;
  return (
    <div>
      <h4 className="font-semibold">{title}</h4>
      <ol className="mt-1 list-decimal space-y-1 pl-5">
        {steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </div>
  );
}

export function SetupGuide(p: {
  listingId: string;
  source: string;
  label: string;
  guide: PlatformGuide;
  caveat: string;
  test: string;
  checklist: ChecklistItem[];
  platformListingId: string | null;
  platformListingName: string | null;
}) {
  const id = useId();
  const [pending, start] = useTransition();
  const [tickState, setTickState] = useState<ChannelFormState>({});
  const [mapState, saveMapping, saving] = useActionState(saveListingMappingAction.bind(null, p.listingId, p.source), {});
  const done = p.checklist.filter((c) => c.done).length;
  return (
    <details className="mt-4 rounded-sm border border-line p-3 md:p-4" data-testid="setup-guide">
      <summary className="cursor-pointer font-semibold">
        Guide pas à pas : connecter ce bien à {p.label}{" "}
        <span className="font-normal text-ink-muted">
          ({done}/{p.checklist.length} étapes faites)
        </span>
      </summary>
      <div className="mt-3 space-y-4">
        <p className="rounded-sm border border-[#8a5a00] bg-[#fff6e0] p-3 text-[#5c3c00]" role="note">
          {p.caveat}
        </p>
        <p>{p.guide.where}</p>
        <div className="grid gap-4 lg:grid-cols-2">
          <Steps title={`1. Donner le lien Sigma à ${p.label} (export)`} steps={p.guide.exportSteps} />
          <Steps title={`2. Donner le lien ${p.label} à Sigma (import)`} steps={p.guide.importSteps} />
          <Steps title="3. Régler les mêmes règles sur la plateforme" steps={p.guide.rulesSteps} />
          <div>
            <h4 className="font-semibold">4. Tester</h4>
            <p className="mt-1">{p.test}</p>
          </div>
        </div>
        {p.guide.notes.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-caption text-ink-muted">
            {p.guide.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}

        <div>
          <h4 className="font-semibold">Liste de vérification</h4>
          <ul className="mt-2 space-y-2" aria-label={`Liste de vérification ${p.label}`}>
            {p.checklist.map((c) => (
              <li key={c.key} className="flex flex-wrap items-center gap-2" data-testid={`check-${c.key}`} data-done={c.done ? "1" : "0"}>
                {c.done ? <CheckCircle2 className="size-5 text-success" aria-hidden="true" /> : <Circle className="size-5 text-ink-faint" aria-hidden="true" />}
                <span className={c.done ? "font-medium" : ""}>
                  {c.label}
                  <span className="sr-only">{c.done ? " : fait" : " : à faire"}</span>
                </span>
                {c.detail && <span className="text-caption text-ink-muted">({c.detail})</span>}
                {c.manual && c.how !== "auto" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 px-3 text-caption"
                    disabled={pending}
                    onClick={() => start(async () => setTickState(await setSetupTickAction(p.listingId, p.source, c.key, !c.done)))}
                  >
                    {c.done ? "Décocher" : "Marquer comme fait"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-2" aria-live="polite">
            {tickState.error && (
              <p role="alert" className="text-error">
                {tickState.error}
              </p>
            )}
          </div>
        </div>

        <form action={saveMapping} className="space-y-2" aria-labelledby={`${id}-map`}>
          <h4 id={`${id}-map`} className="font-semibold">
            Nom de ce bien sur la plateforme
          </h4>
          <p className="text-caption text-ink-muted">Sert à rattacher les e-mails de réservation de {p.label} à ce bien (identifiant de l&apos;annonce ou de l&apos;établissement, et/ou son titre sur la plateforme).</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="block text-caption font-semibold">Identifiant sur {p.label}</span>
              <input name="platformListingId" maxLength={200} defaultValue={p.platformListingId ?? ""} className={`${input} mt-1`} autoComplete="off" />
            </label>
            <label className="block">
              <span className="block text-caption font-semibold">Titre sur {p.label}</span>
              <input name="platformListingName" maxLength={200} defaultValue={p.platformListingName ?? ""} className={`${input} mt-1`} autoComplete="off" />
            </label>
          </div>
          <Button type="submit" size="sm" variant="outline" disabled={saving}>
            Enregistrer la correspondance
          </Button>
          <div aria-live="polite">
            {mapState.error && (
              <p role="alert" className="text-error">
                {mapState.error}
              </p>
            )}
            {mapState.message && (
              <p role="status" className="rounded-sm bg-brand-tint p-3 font-medium text-brand-deep">
                {mapState.message}
              </p>
            )}
          </div>
        </form>
      </div>
    </details>
  );
}
