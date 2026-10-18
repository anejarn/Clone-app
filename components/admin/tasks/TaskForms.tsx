"use client";

import { useActionState } from "react";
import {
  assignTaskAction,
  cancelTaskAction,
  createTaskAction,
  reopenTaskAction,
  rescheduleTaskAction,
  updateTaskNotesAction,
  type TaskActionState,
} from "@/app/admin/operations/actions";
import { Button } from "@/components/ui/Button";
import { TASK_LIMITS } from "@/lib/admin/task-form";
import { TASK_TYPE_TITLE, TASK_TYPES } from "@/lib/operations/labels";

/** Forms of Opérations (associés). Each posts to a server action that checks access and the rules again. */

export interface Member {
  id: string;
  name: string;
  role: string;
}

const input =
  "h-11 w-full rounded-sm border border-ink-faint bg-white px-3 text-body-l outline-none focus:border-ink focus:ring-1 focus:ring-ink aria-[invalid=true]:border-error";
const card = "rounded-lg border border-line bg-white p-4 md:p-6";
const ROLE = { ADMIN: "associé", AGENT: "agent" } as Record<string, string>;

function Feedback({ state }: { state: TaskActionState }) {
  if (state.error) {
    return (
      <div role="alert" className="rounded-sm border border-error bg-[#fdecea] p-3 text-error">
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

function MemberOptions({ members }: { members: Member[] }) {
  return (
    <>
      {members.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name} ({ROLE[m.role] ?? m.role})
        </option>
      ))}
    </>
  );
}

export function AssignForm({ taskId, assigneeId, members, compact = false }: { taskId: string; assigneeId: string | null; members: Member[]; compact?: boolean }) {
  const [state, action, pending] = useActionState(assignTaskAction.bind(null, taskId), {});
  if (compact) {
    return (
      <form action={action} className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`assignee-${taskId}`}>
          Affecter à
        </label>
        <select id={`assignee-${taskId}`} name="assigneeId" defaultValue={assigneeId ?? ""} className="h-9 rounded-sm border border-ink-faint bg-white px-2 text-body">
          <option value="">Personne</option>
          <MemberOptions members={members} />
        </select>
        <Button type="submit" variant="outline" size="sm" disabled={pending} className="h-9">
          {pending ? "…" : "Affecter"}
        </Button>
        {state.error && (
          <span role="alert" className="w-full text-caption text-error">
            {state.error}
          </span>
        )}
      </form>
    );
  }
  return (
    <form action={action} className={`${card} space-y-3`}>
      <h2 className="text-title-s font-semibold">Affectation</h2>
      <Feedback state={state} />
      <label className="block">
        <span className="mb-1 block text-micro font-medium">Affecter à</span>
        <select name="assigneeId" defaultValue={assigneeId ?? ""} className={input}>
          <option value="">Personne (non affectée)</option>
          <MemberOptions members={members} />
        </select>
      </label>
      <Button type="submit" variant="dark" disabled={pending}>
        {pending ? "Un instant…" : "Enregistrer l'affectation"}
      </Button>
    </form>
  );
}

function TimeFields({ day, start, end, errors }: { day: string; start: string; end: string; errors?: TaskActionState["fieldErrors"] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="block">
        <span className="mb-1 block text-micro font-medium">Date</span>
        <input type="date" name="day" required defaultValue={day} aria-invalid={!!errors?.day} className={input} />
      </label>
      <label className="block">
        <span className="mb-1 block text-micro font-medium">Début</span>
        <input type="time" name="start" required defaultValue={start} aria-invalid={!!errors?.start} className={input} />
      </label>
      <label className="block">
        <span className="mb-1 block text-micro font-medium">Fin</span>
        <input type="time" name="end" required defaultValue={end} aria-invalid={!!errors?.end} className={input} />
      </label>
    </div>
  );
}

export function RescheduleTaskForm({ taskId, day, start, end }: { taskId: string; day: string; start: string; end: string }) {
  const [state, action, pending] = useActionState(rescheduleTaskAction.bind(null, taskId), {});
  return (
    <form action={action} noValidate className={`${card} space-y-3`}>
      <h2 className="text-title-s font-semibold">Date et horaire</h2>
      <p className="text-ink-muted">Heure de Marrakech. Si les dates du séjour changent ensuite, la tâche suit le séjour.</p>
      <Feedback state={state} />
      <TimeFields day={day} start={start} end={end} errors={state.fieldErrors} />
      <Button type="submit" variant="dark" disabled={pending}>
        {pending ? "Un instant…" : "Enregistrer l'horaire"}
      </Button>
    </form>
  );
}

export function NotesForm({ taskId, notes }: { taskId: string; notes: string | null }) {
  const [state, action, pending] = useActionState(updateTaskNotesAction.bind(null, taskId), {});
  return (
    <form action={action} className={`${card} space-y-3`}>
      <h2 className="text-title-s font-semibold">Consignes pour l&apos;agent</h2>
      <Feedback state={state} />
      <label className="block">
        <span className="sr-only">Consignes</span>
        <textarea name="notes" rows={3} maxLength={TASK_LIMITS.notes} defaultValue={notes ?? ""} className={`${input} h-auto py-2`} />
      </label>
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Un instant…" : "Enregistrer les consignes"}
      </Button>
    </form>
  );
}

export function CancelTaskForm({ taskId }: { taskId: string }) {
  const [state, action, pending] = useActionState(cancelTaskAction.bind(null, taskId), {});
  return (
    <form action={action} className={`${card} space-y-3`}>
      <h2 className="text-title-s font-semibold">Annuler la tâche</h2>
      <Feedback state={state} />
      <label className="flex items-start gap-3">
        <input type="checkbox" name="confirm" required className="mt-1 size-4 accent-brand" />
        <span>Je confirme l&apos;annulation</span>
      </label>
      <Button type="submit" variant="outline" disabled={pending} className="border-error text-error hover:bg-[#fdecea]">
        {pending ? "Un instant…" : "Annuler la tâche"}
      </Button>
    </form>
  );
}

export function ReopenTaskForm({ taskId }: { taskId: string }) {
  const [state, action, pending] = useActionState(reopenTaskAction.bind(null, taskId), {});
  return (
    <form action={action} className={`${card} space-y-3`}>
      <h2 className="text-title-s font-semibold">Remettre à faire</h2>
      <p className="text-ink-muted">La check-list et les photos sont conservées.</p>
      <Feedback state={state} />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Un instant…" : "Remettre « à faire »"}
      </Button>
    </form>
  );
}

export function ManualTaskForm({
  listings,
  members,
  defaults,
}: {
  listings: { id: string; title: string; address: string }[];
  members: Member[];
  defaults: { day: string; listingId?: string };
}) {
  const [state, action, pending] = useActionState(createTaskAction, {});
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} noValidate className={`${card} space-y-4`}>
      <Feedback state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-micro font-medium">Bien</span>
          <select name="listingId" required defaultValue={v.listingId ?? defaults.listingId ?? ""} aria-invalid={!!e.listingId} className={input}>
            <option value="">Choisir…</option>
            {listings.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title} — {l.address}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-micro font-medium">Type</span>
          <select name="type" required defaultValue={v.type ?? "OTHER"} aria-invalid={!!e.type} className={input}>
            {TASK_TYPES.map((t) => (
              <option key={t} value={t}>
                {TASK_TYPE_TITLE[t]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-micro font-medium">Titre (obligatoire pour « Tâche »)</span>
        <input name="title" maxLength={TASK_LIMITS.title} defaultValue={v.title ?? ""} aria-invalid={!!e.title} className={input} />
      </label>
      <TimeFields day={v.day ?? defaults.day} start={v.start ?? "10:00"} end={v.end ?? "12:00"} errors={e} />
      <label className="block">
        <span className="mb-1 block text-micro font-medium">Affecter à</span>
        <select name="assigneeId" defaultValue={v.assigneeId ?? ""} aria-invalid={!!e.assigneeId} className={input}>
          <option value="">Personne pour l&apos;instant</option>
          <MemberOptions members={members} />
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-micro font-medium">Consignes</span>
        <textarea name="notes" rows={3} maxLength={TASK_LIMITS.notes} defaultValue={v.notes ?? ""} aria-invalid={!!e.notes} className={`${input} h-auto py-2`} />
      </label>
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Un instant…" : "Créer la tâche"}
      </Button>
    </form>
  );
}
