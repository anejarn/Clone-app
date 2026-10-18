import { IdCard, Wrench } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { TaskCodes } from "@/components/admin/guide/GuideForms";
import { TaskFacts } from "@/components/admin/tasks/TaskSummary";
import { TaskWork } from "@/components/admin/tasks/TaskWork";
import { canSeeAllTasks } from "@/lib/admin/sections";
import { requireAdminPage } from "@/lib/server/authz";
import { canRevealForTask } from "@/lib/guide/access";
import { canCaptureForTask } from "@/lib/declarations/access";
import { getTask, tasksToday } from "@/lib/server/operations/tasks";
import { ID_RE } from "@/lib/server/schemas";

export const metadata: Metadata = { title: "Tâche" };

/** A task to do: what, where, when, and its check-list with photos. Agents reach only their own tasks (404 otherwise). */
export default function Page({ params }: PageProps<"/admin/mes-taches/[id]">) {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const access = await requireAdminPage("/admin/mes-taches");
  const { id } = await params;
  const task = ID_RE.test(id) ? await getTask(access, id) : null;
  if (!task) notFound();
  const admin = canSeeAllTasks(access.user.role);

  return (
    <AdminPage
      title={`${task.title} · ${task.listingTitle}`}
      intro={
        <>
          <Link href="/admin/mes-taches" className="underline underline-offset-2">
            Mes tâches
          </Link>
          {admin && (
            <>
              {" · "}
              <Link href={`/admin/operations/${task.id}`} className="underline underline-offset-2">
                Fiche dans Opérations
              </Link>
            </>
          )}
        </>
      }
    >
      <div className="space-y-5">
        <section className="rounded-lg border border-line bg-white p-4 md:p-6">
          <TaskFacts task={task} />
          <Link href={`/admin/pannes/nouvelle?tache=${task.id}`} className="mt-4 inline-flex h-11 items-center gap-2 rounded-sm border border-ink bg-white px-4 font-semibold hover:bg-surface-2">
            <Wrench className="size-4" aria-hidden="true" />
            Signaler une panne
          </Link>
        </section>
        {canRevealForTask({ role: access.user.role, userId: access.user.id }, { assigneeId: task.assignee?.id ?? null, scheduledDate: new Date(`${task.scheduledDate}T00:00:00Z`), status: task.status }, tasksToday()) && (
          <TaskCodes taskId={task.id} />
        )}
        {canCaptureForTask(
          { role: access.user.role, userId: access.user.id },
          { type: task.type, bookingId: task.booking?.id ?? null, assigneeId: task.assignee?.id ?? null, scheduledDate: new Date(`${task.scheduledDate}T00:00:00Z`), status: task.status },
          tasksToday(),
        ) && (
          <section className="rounded-lg border border-line bg-white p-4 md:p-6" aria-labelledby="travelers-link-title" data-testid="task-travelers">
            <h2 id="travelers-link-title" className="text-title-s font-semibold">
              Pièces d&apos;identité des voyageurs
            </h2>
            <p className="mt-1 text-ink-muted">Fiche de police de chaque adulte, avec la photo de sa pièce : à saisir à l&apos;arrivée.</p>
            <Link href={`/admin/mes-taches/${task.id}/voyageurs`} className="mt-3 inline-flex h-11 items-center gap-2 rounded-sm bg-brand px-4 font-semibold text-white hover:bg-brand-strong">
              <IdCard className="size-4" aria-hidden="true" />
              Saisir les voyageurs
            </Link>
          </section>
        )}
        {task.status === "CANCELLED" ? (
          <p className="rounded-lg border border-line bg-white p-4 text-ink-muted">Cette tâche est annulée.</p>
        ) : (
          <TaskWork taskId={task.id} status={task.status} items={task.items} />
        )}
      </div>
    </AdminPage>
  );
}
