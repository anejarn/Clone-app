import { CheckCircle2, ListChecks } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { CancelTaskForm, NotesForm, ReopenTaskForm, RescheduleTaskForm, AssignForm } from "@/components/admin/tasks/TaskForms";
import { TaskFacts } from "@/components/admin/tasks/TaskSummary";
import { AuditList } from "@/components/admin/users/AuditList";
import { recentAudit } from "@/lib/server/audit";
import { requireAdminPage } from "@/lib/server/authz";
import { getTask, taskAssignees } from "@/lib/server/operations/tasks";
import { ID_RE } from "@/lib/server/schemas";

export const metadata: Metadata = { title: "Tâche" };

export default function Page({ params, searchParams }: PageProps<"/admin/operations/[id]">) {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireAdminPage("/admin/operations");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  // Another organization's task is "not found", as an unknown one.
  const task = ID_RE.test(id) ? await getTask(access, id) : null;
  if (!task) notFound();
  const [members, history] = await Promise.all([taskAssignees(access.organizationId), recentAudit(access.organizationId, { targetId: task.id })]);
  const open = task.status === "TODO" || task.status === "IN_PROGRESS";
  const photos = task.items.flatMap((i) => i.photos.map((p, n) => ({ ...p, alt: `${i.label}, photo ${n + 1}` })));

  return (
    <AdminPage
      title={`${task.title} · ${task.listingTitle}`}
      intro={
        <Link href="/admin/operations" className="underline underline-offset-2">
          Opérations
        </Link>
      }
    >
      <div className="space-y-5">
        {sp.cree === "1" && (
          <p role="status" className="flex items-center gap-2 rounded-lg border border-line bg-brand-tint p-4 font-medium text-brand-deep">
            <CheckCircle2 className="size-5 shrink-0" aria-hidden="true" />
            Tâche créée.
          </p>
        )}
        <section className="rounded-lg border border-line bg-white p-4 md:p-6">
          <TaskFacts task={task} bookingHref={task.booking ? `/admin/reservations/${task.booking.id}` : undefined} />
          <Link href={`/admin/mes-taches/${task.id}`} className="mt-5 inline-flex items-center gap-2 font-semibold underline underline-offset-2">
            <ListChecks className="size-4" aria-hidden="true" />
            Ouvrir la check-list (vue agent)
          </Link>
        </section>

        {open && (
          <div className="grid gap-5 lg:grid-cols-2">
            <AssignForm taskId={task.id} assigneeId={task.assignee?.id ?? null} members={members} />
            <RescheduleTaskForm taskId={task.id} day={task.scheduledDate} start={task.startTime} end={task.endTime} />
          </div>
        )}

        <section aria-labelledby="checklist-title" className="rounded-lg border border-line bg-white">
          <h2 id="checklist-title" className="border-b border-line px-4 py-3 text-title-s font-semibold md:px-6">
            Check-list <span className="font-normal text-ink-muted">({task.checkedCount}/{task.itemCount})</span>
          </h2>
          <ul className="divide-y divide-line" data-testid="checklist">
            {task.items.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 md:px-6" data-testid="checklist-item" data-checked={i.checked}>
                <span className={i.checked ? "" : "text-ink-muted"}>
                  {i.checked ? "✓ " : "○ "}
                  {i.label}
                </span>
                {i.requiresPhoto && (
                  <span className={`text-caption font-medium ${i.photos.length ? "text-success" : "text-error"}`}>
                    {i.photos.length ? `${i.photos.length} photo${i.photos.length > 1 ? "s" : ""}` : "Photo obligatoire manquante"}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {photos.length > 0 && (
            <ul className="grid grid-cols-2 gap-3 border-t border-line p-4 sm:grid-cols-4 md:p-6" data-testid="task-photos">
              {photos.map((p) => (
                <li key={p.id}>
                  <a href={p.url} target="_blank" rel="noreferrer">
                    {/* Plain <img>: task photos are staff-only (app/media), which the image optimizer can't fetch. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt={p.alt} className="aspect-[4/3] w-full rounded-sm border border-line object-cover" loading="lazy" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          <NotesForm taskId={task.id} notes={task.notes} />
          {open ? <CancelTaskForm taskId={task.id} /> : <ReopenTaskForm taskId={task.id} />}
        </div>

        <section aria-labelledby="history-title">
          <h2 id="history-title" className="mb-3 text-title-s font-semibold">
            Historique
          </h2>
          <AuditList entries={history} />
        </section>
      </div>
    </AdminPage>
  );
}
