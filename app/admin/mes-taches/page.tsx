import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { dayHeading, TaskCard } from "@/components/admin/tasks/TaskSummary";
import { addDays, isoDay, parseDay } from "@/lib/admin/calendar";
import { pluralize } from "@/lib/format";
import { requireAdminPage } from "@/lib/server/authz";
import { myTasks, tasksToday, type TaskView } from "@/lib/server/operations/tasks";

export const metadata: Metadata = { title: "Mes tâches" };

/**
 * The tasks assigned to the person signed in, for today and tomorrow (or from ?jour=, two days), on a phone first.
 * Kept small (a server page, links, no client state) so that the offline "Ma journée" can take it over.
 */
export default function Page({ searchParams }: PageProps<"/admin/mes-taches">) {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireAdminPage("/admin/mes-taches");
  const sp = await searchParams;
  const today = tasksToday();
  const from = (typeof sp.jour === "string" && parseDay(sp.jour)) || today;
  const tasks = await myTasks(access, from, addDays(from, 2));
  const days = [isoDay(from), isoDay(addDays(from, 1))];
  const byDay = new Map<string, TaskView[]>(days.map((d) => [d, []]));
  for (const t of tasks) byDay.get(t.scheduledDate)?.push(t);
  const link = (d: Date) => `/admin/mes-taches?jour=${isoDay(d)}`;

  return (
    <AdminPage title="Mes tâches" intro="Les tâches qui vous sont affectées. Ouvrez-en une pour la commencer, cocher la check-list et prendre les photos.">
      <nav aria-label="Jours" className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link href={link(addDays(from, -2))} className="font-semibold underline underline-offset-2">
          Jours précédents
        </Link>
        {isoDay(from) !== isoDay(today) && (
          <Link href="/admin/mes-taches" className="font-semibold underline underline-offset-2">
            Aujourd&apos;hui
          </Link>
        )}
        <Link href={link(addDays(from, 2))} className="font-semibold underline underline-offset-2">
          Jours suivants
        </Link>
        <Link href="/admin/pannes/nouvelle" className="font-semibold underline underline-offset-2">
          Signaler une panne
        </Link>
      </nav>
      <div className="space-y-6">
        {[...byDay].map(([d, list]) => (
          <section key={d} aria-labelledby={`day-${d}`} data-testid="task-day" data-day={d}>
            <h2 id={`day-${d}`} className="mb-2 text-title-s font-semibold">
              {dayHeading(d, isoDay(today))} <span className="font-normal text-ink-muted">· {pluralize(list.length, "tâche", "tâches")}</span>
            </h2>
            {list.length === 0 ? (
              <p className="rounded-lg border border-line bg-white p-4 text-ink-muted">Aucune tâche ce jour-là.</p>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line bg-white">
                {list.map((t) => (
                  <TaskCard key={t.id} task={t} href={`/admin/mes-taches/${t.id}`} showAssignee={false} />
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </AdminPage>
  );
}
