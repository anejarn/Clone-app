"use client";

import { Camera } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import {
  addTicketPhotoAction,
  assignTicketAction,
  commentTicketAction,
  createTicketAction,
  setTicketCostAction,
  setTicketPriorityAction,
  setTicketStatusAction,
  type TicketActionState,
} from "@/app/admin/pannes/actions";
import { compressPhoto } from "@/components/admin/tasks/compress";
import { Button } from "@/components/ui/Button";
import { TICKET_LIMITS } from "@/lib/admin/ticket-form";
import type { TicketPriority, TicketStatus, TicketWaitingFor } from "@/lib/generated/prisma/enums";
import {
  TICKET_CATEGORIES,
  TICKET_CATEGORY_LABEL,
  TICKET_PRIORITIES,
  TICKET_PRIORITY_LABEL,
  TICKET_STATUS_LABEL,
  TICKET_WAITING,
  TICKET_WAITING_LABEL,
} from "@/lib/operations/tickets";
import { MAX_PHOTO_BYTES } from "@/lib/storage/images";

/** Forms of Pannes. Each posts to a server action (app/admin/pannes/actions.ts) that checks access and the rules again. */

const input =
  "h-11 w-full rounded-sm border border-ink-faint bg-white px-3 text-body-l outline-none focus:border-ink focus:ring-1 focus:ring-ink aria-[invalid=true]:border-error";
const card = "rounded-lg border border-line bg-white p-4 md:p-6";
const ACCEPT = ["image/jpeg", "image/png", "image/webp"];

function Feedback({ state }: { state: TicketActionState }) {
  if (state.error) {
    return (
      <div role="alert" className="rounded-sm border border-error bg-[#fdecea] p-3 text-error" data-testid="ticket-error">
        <p>{state.error}</p>
        {state.fieldErrors && (
          <ul className="mt-1 list-disc pl-5">
            {Object.entries(state.fieldErrors).map(([k, m]) => (
              <li key={k}>{m}</li>
            ))}
          </ul>
        )}
      </div>
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

/** The chosen photo, shrunk like the task photos (compress.ts); an error message when it can't be sent. */
async function preparedPhoto(file: File | undefined | null): Promise<{ file?: File; error?: string }> {
  if (!file || file.size === 0) return {};
  if (!ACCEPT.includes(file.type)) return { error: "Format non accepté : JPEG, PNG ou WebP." };
  const small = await compressPhoto(file);
  if (small.size > MAX_PHOTO_BYTES) return { error: `Photo trop lourde : ${MAX_PHOTO_BYTES / 1024 / 1024} Mo au maximum.` };
  return { file: small };
}

function PhotoPicker({ name = "photo", label, onChange }: { name?: string; label: string; onChange?: (f: File | null) => void }) {
  const [chosen, setChosen] = useState<string | null>(null);
  return (
    <div>
      <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-sm border border-ink bg-white px-4 font-semibold hover:bg-surface-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink">
        <Camera className="size-4" aria-hidden="true" />
        {label}
        <input
          type="file"
          name={name}
          accept={ACCEPT.join(",")}
          capture="environment"
          className="sr-only"
          aria-label={label}
          onChange={(e) => {
            const f = e.currentTarget.files?.[0] ?? null;
            setChosen(f?.name ?? null);
            onChange?.(f);
          }}
        />
      </label>
      {chosen && <p className="mt-1 text-caption text-ink-muted">Photo choisie : {chosen}</p>}
    </div>
  );
}

export interface ListingOption {
  id: string;
  title: string;
  address: string;
}

/** A new ticket, from a task (its home is known) or on a home chosen from the list. One optional photo. */
export function NewTicketForm({ listings, task, defaultListingId }: { listings: ListingOption[]; task?: { id: string; label: string }; defaultListingId?: string }) {
  const [state, setState] = useState<TicketActionState>({});
  const [pending, start] = useTransition();
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};

  function submit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const form = new FormData(ev.currentTarget);
    start(async () => {
      const photo = await preparedPhoto(form.get("photo") as File | null);
      if (photo.error) return setState({ error: photo.error, values: Object.fromEntries([...form].filter(([, x]) => typeof x === "string")) as Record<string, string> });
      form.delete("photo");
      if (photo.file) form.set("photo", photo.file);
      // Redirects to the new ticket's page on success.
      setState(await createTicketAction({}, form));
    });
  }

  return (
    <form onSubmit={submit} noValidate className={`${card} space-y-4`}>
      <Feedback state={state} />
      {task ? (
        <p className="rounded-sm bg-surface-2 p-3">
          <input type="hidden" name="taskId" value={task.id} />
          Signalée pendant la tâche : <strong>{task.label}</strong>
        </p>
      ) : (
        <label className="block">
          <span className="mb-1 block text-micro font-medium">Bien</span>
          <select name="listingId" required defaultValue={v.listingId ?? defaultListingId ?? ""} aria-invalid={!!e.listingId} className={input}>
            <option value="">Choisir…</option>
            {listings.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title} — {l.address}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block">
        <span className="mb-1 block text-micro font-medium">Ce qui ne va pas</span>
        <input name="title" required maxLength={TICKET_LIMITS.title} defaultValue={v.title ?? ""} aria-invalid={!!e.title} placeholder="Ex. : fuite sous l'évier de la cuisine" className={input} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-micro font-medium">Catégorie</span>
          <select name="category" required defaultValue={v.category ?? ""} aria-invalid={!!e.category} className={input}>
            <option value="">Choisir…</option>
            {TICKET_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {TICKET_CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-micro font-medium">Priorité</span>
          <select name="priority" defaultValue={v.priority ?? "NORMAL"} aria-invalid={!!e.priority} className={input}>
            {TICKET_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {TICKET_PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-micro font-medium">Détails (facultatif)</span>
        <textarea name="description" rows={4} maxLength={TICKET_LIMITS.description} defaultValue={v.description ?? ""} aria-invalid={!!e.description} className={`${input} h-auto py-2`} />
      </label>
      <PhotoPicker label="Prendre une photo" />
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Envoi…" : "Signaler la panne"}
      </Button>
    </form>
  );
}

export function CommentForm({ ticketId }: { ticketId: string }) {
  const [state, action, pending] = useActionState(commentTicketAction.bind(null, ticketId), {});
  // React resets the form (the text) once the action has run.
  return (
    <form action={action} className={`${card} space-y-3`}>
      <Feedback state={state} />
      <label className="block">
        <span className="mb-1 block text-micro font-medium">Ajouter un commentaire</span>
        <textarea name="body" rows={3} required maxLength={TICKET_LIMITS.comment} className={`${input} h-auto py-2`} />
      </label>
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Un instant…" : "Publier le commentaire"}
      </Button>
    </form>
  );
}

export function TicketPhotoForm({ ticketId }: { ticketId: string }) {
  const [state, setState] = useState<TicketActionState>({});
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <Feedback state={state} />
      {pending ? (
        <p className="text-ink-muted">Envoi de la photo…</p>
      ) : (
        <PhotoPicker
          name="extra"
          label="Ajouter une photo"
          onChange={(file) =>
            start(async () => {
              const photo = await preparedPhoto(file);
              if (photo.error || !photo.file) return setState({ error: photo.error ?? "Choisissez une photo." });
              const form = new FormData();
              form.set("photo", photo.file);
              setState(await addTicketPhotoAction(ticketId, form));
            })
          }
        />
      )}
    </div>
  );
}

export function StatusForm({ ticketId, status, waitingFor, statuses }: { ticketId: string; status: TicketStatus; waitingFor: TicketWaitingFor | null; statuses: TicketStatus[] }) {
  const [state, action, pending] = useActionState(setTicketStatusAction.bind(null, ticketId), {});
  const [to, setTo] = useState<TicketStatus>(statuses.includes(status) ? status : statuses[0]);
  return (
    <form action={action} className={`${card} space-y-3`}>
      <h2 className="text-title-s font-semibold">Suivi</h2>
      <Feedback state={state} />
      <label className="block">
        <span className="mb-1 block text-micro font-medium">Nouveau statut</span>
        <select name="status" value={to} onChange={(e) => setTo(e.target.value as TicketStatus)} className={input}>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {TICKET_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </label>
      {to === "WAITING" && (
        <label className="block">
          <span className="mb-1 block text-micro font-medium">En attente</span>
          <select name="waitingFor" defaultValue={waitingFor ?? ""} required className={input}>
            <option value="">Choisir…</option>
            {TICKET_WAITING.map((w) => (
              <option key={w} value={w}>
                {TICKET_WAITING_LABEL[w]}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block">
        <span className="mb-1 block text-micro font-medium">Note (facultatif)</span>
        <input name="note" maxLength={TICKET_LIMITS.comment} className={input} />
      </label>
      <Button type="submit" variant="dark" disabled={pending}>
        {pending ? "Un instant…" : "Enregistrer le statut"}
      </Button>
    </form>
  );
}

export function TicketAssignForm({ ticketId, assigneeId, members }: { ticketId: string; assigneeId: string | null; members: { id: string; name: string; role: string }[] }) {
  const [state, action, pending] = useActionState(assignTicketAction.bind(null, ticketId), {});
  return (
    <form action={action} className={`${card} space-y-3`}>
      <h2 className="text-title-s font-semibold">Affectation</h2>
      <Feedback state={state} />
      <label className="block">
        <span className="mb-1 block text-micro font-medium">Confier à</span>
        <select name="assigneeId" defaultValue={assigneeId ?? ""} className={input}>
          <option value="">Personne</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.role === "ADMIN" ? "associé" : "agent"})
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" variant="dark" disabled={pending}>
        {pending ? "Un instant…" : "Enregistrer l'affectation"}
      </Button>
    </form>
  );
}

export function PriorityForm({ ticketId, priority }: { ticketId: string; priority: TicketPriority }) {
  const [state, action, pending] = useActionState(setTicketPriorityAction.bind(null, ticketId), {});
  return (
    <form action={action} className={`${card} space-y-3`}>
      <h2 className="text-title-s font-semibold">Priorité</h2>
      <Feedback state={state} />
      <label className="block">
        <span className="sr-only">Priorité</span>
        <select name="priority" defaultValue={priority} className={input}>
          {TICKET_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {TICKET_PRIORITY_LABEL[p]}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Un instant…" : "Enregistrer la priorité"}
      </Button>
    </form>
  );
}

export function CostForm({ ticketId, cost, rechargeOwner }: { ticketId: string; cost: string; rechargeOwner: boolean }) {
  const [state, action, pending] = useActionState(setTicketCostAction.bind(null, ticketId), {});
  return (
    <form action={action} noValidate className={`${card} space-y-3`}>
      <h2 className="text-title-s font-semibold">Coût de la réparation</h2>
      <Feedback state={state} />
      <label className="block">
        <span className="mb-1 block text-micro font-medium">Montant (MAD)</span>
        <input name="cost" inputMode="decimal" defaultValue={cost} aria-invalid={!!state.fieldErrors?.cost} className={input} />
      </label>
      <label className="flex items-start gap-3">
        <input type="checkbox" name="rechargeOwner" defaultChecked={rechargeOwner} className="mt-1 size-4 accent-brand" />
        <span>À refacturer au propriétaire (repris dans son relevé, lot 6)</span>
      </label>
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Un instant…" : "Enregistrer le coût"}
      </Button>
    </form>
  );
}
