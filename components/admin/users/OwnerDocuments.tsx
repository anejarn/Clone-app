"use client";

import { Trash2 } from "lucide-react";
import { useActionState, useId, useState, useTransition } from "react";
import { addOwnerDocumentAction, deleteOwnerDocumentAction, type ActionState, type DocumentState } from "@/app/admin/utilisateurs/actions";
import { Button } from "@/components/ui/Button";

const input = "h-11 w-full rounded-sm border border-ink-faint bg-white px-3 text-body-l outline-none focus:border-ink focus:ring-1 focus:ring-ink";

export interface OwnerDocumentRow {
  id: string;
  title: string;
  kindLabel: string;
  listingTitle: string | null;
  added: string;
  size: string;
}

function Feedback({ state }: { state: ActionState }) {
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

/** An owner's documents (member page, ADMIN): list, download, delete, and the upload form. */
export function OwnerDocuments({ ownerId, docs, listings, kinds }: { ownerId: string; docs: OwnerDocumentRow[]; listings: { id: string; title: string }[]; kinds: { value: string; label: string }[] }) {
  const [state, action, pending] = useActionState<DocumentState, FormData>(addOwnerDocumentAction.bind(null, ownerId), {});
  const [removing, start] = useTransition();
  const [removed, setRemoved] = useState<ActionState>({});
  const ids = { kind: useId(), title: useId(), listing: useId(), file: useId() };
  return (
    <section className="space-y-4 rounded-lg border border-line bg-white p-4 md:p-6" aria-labelledby="owner-docs-title" data-testid="owner-documents-admin">
      <h2 id="owner-docs-title" className="text-title-s font-semibold">
        Documents du propriétaire
      </h2>
      <p className="text-caption text-ink-muted">Mandat de gestion, contrat, autorisation 80-14, assurance… Le propriétaire les télécharge depuis son espace (Documents).</p>
      <Feedback state={removed} />
      {docs.length === 0 ? (
        <p className="text-ink-muted">Aucun document partagé.</p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {docs.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="owner-document">
              <span>
                <a href={`/api/owner-documents/${d.id}`} className="font-semibold underline underline-offset-2">
                  {d.title}
                </a>
                <span className="block text-caption text-ink-muted">
                  {d.kindLabel}
                  {d.listingTitle && ` · ${d.listingTitle}`} · {d.added} · {d.size}
                </span>
              </span>
              <Button
                type="button"
                variant="link"
                disabled={removing}
                onClick={() =>
                  confirm(`Supprimer « ${d.title} » ? Le propriétaire ne le verra plus.`) &&
                  start(async () => {
                    setRemoved(await deleteOwnerDocumentAction(d.id));
                  })
                }
              >
                <Trash2 className="size-4" aria-hidden="true" />
                Supprimer
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form action={action} key={state.saved ?? 0} className="space-y-3 border-t border-line pt-4" aria-label="Ajouter un document">
        <Feedback state={state} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={ids.kind} className="mb-1 block text-micro font-medium">
              Type
            </label>
            <select id={ids.kind} name="kind" defaultValue="MANDATE" className={input}>
              {kinds.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={ids.title} className="mb-1 block text-micro font-medium">
              Titre
            </label>
            <input id={ids.title} name="title" required minLength={2} maxLength={160} className={input} />
          </div>
          <div>
            <label htmlFor={ids.listing} className="mb-1 block text-micro font-medium">
              Bien (facultatif)
            </label>
            <select id={ids.listing} name="listingId" defaultValue="" className={input}>
              <option value="">Tous ses biens</option>
              {listings.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={ids.file} className="mb-1 block text-micro font-medium">
              Fichier (PDF ou photo, 5 Mo au plus)
            </label>
            <input id={ids.file} name="file" type="file" required accept="application/pdf,image/jpeg,image/png,image/webp" className="block w-full text-body" />
          </div>
        </div>
        <Button type="submit" variant="dark" size="sm" disabled={pending}>
          {pending ? "Envoi…" : "Ajouter le document"}
        </Button>
      </form>
    </section>
  );
}
