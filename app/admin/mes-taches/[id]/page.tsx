import { Wrench } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { TaskFacts } from "@/components/admin/tasks/TaskSummary";
import { TaskWork } from "@/components/admin/tasks/TaskWork";
import { canSeeAllTasks } from "@/lib/admin/sections";
import { requireAdminPage } from "@/lib/server/authz";
import { getTask } from "@/lib/server/operations/tasks";
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
        {task.status === "CANCELLED" ? (
          <p className="rounded-lg border border-line bg-white p-4 text-ink-muted">Cette tâche est annulée.</p>
        ) : (
          <TaskWork taskId={task.id} status={task.status} items={task.items} />
        )}
      </div>
    </AdminPage>
  );
}
