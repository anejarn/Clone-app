import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { AssignForm } from "@/components/admin/tasks/TaskForms";
import { dayHeading, TaskCard } from "@/components/admin/tasks/TaskSummary";
import { addDays, isoDay, parseDay } from "@/lib/admin/calendar";
import { pluralize } from "@/lib/format";
import { TASK_STATUS_LABEL, TASK_STATUS_PARAM, TASK_TYPE_LABEL, TASK_TYPE_PARAM } from "@/lib/operations/labels";
import { requireAdminPage } from "@/lib/server/authz";
import { listTasks, taskAssignees, tasksToday, taskListings, type TaskView } from "@/lib/server/operations/tasks";

export const metadata: Metadata = { title: "Opérations" };

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
const pick = <T extends Record<string, string>>(map: T, v: string): T[keyof T] | undefined => (Object.hasOwn(map, v) ? map[v as keyof T] : undefined);
const SPANS = { "1": 1, "3": 3, "7": 7, "14": 14 } as const;

export default function Page({ searchParams }: PageProps<"/admin/operations">) {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: Promise<Search> }) {
  const { organizationId } = await requireAdminPage("/admin/operations");
  const sp = await searchParams;
  const today = tasksToday();
  const [listings, members] = await Promise.all([taskListings(organizationId), taskAssignees(organizationId)]);
  const raw = {
    du: parseDay(one(sp.du)) ? one(sp.du) : isoDay(today),
    jours: Object.hasOwn(SPANS, one(sp.jours)) ? one(sp.jours) : "7",
    bien: listings.some((l) => l.id === one(sp.bien)) ? one(sp.bien) : "",
    agent: one(sp.agent) === "aucun" || members.some((m) => m.id === one(sp.agent)) ? one(sp.agent) : "",
    statut: Object.hasOwn(TASK_STATUS_PARAM, one(sp.statut)) ? one(sp.statut) : "",
    type: Object.hasOwn(TASK_TYPE_PARAM, one(sp.type)) ? one(sp.type) : "",
  };
  const from = parseDay(raw.du)!;
  const span = SPANS[raw.jours as keyof typeof SPANS];
  const { items, truncated } = await listTasks(organizationId, {
    from,
    to: addDays(from, span),
    listingId: raw.bien || undefined,
    assignee: raw.agent === "aucun" ? "none" : raw.agent || undefined,
    status: pick(TASK_STATUS_PARAM, raw.statut),
    type: pick(TASK_TYPE_PARAM, raw.type),
  });
  const byDay = new Map<string, TaskView[]>();
  for (const t of items) byDay.set(t.scheduledDate, [...(byDay.get(t.scheduledDate) ?? []), t]);
  const unassigned = items.filter((t) => !t.assignee && (t.status === "TODO" || t.status === "IN_PROGRESS")).length;
  const field = "h-11 w-full rounded-sm border border-ink-faint bg-white px-3 outline-none focus:border-ink focus:ring-1 focus:ring-ink";
  const nav = (days: number) => `/admin/operations?${new URLSearchParams({ ...raw, du: isoDay(addDays(from, days)) })}`;

  return (
    <AdminPage
      title="Opérations"
      intro="Les tâches terrain des biens : ménage après chaque départ, linge et accueil à chaque arrivée (créés avec la réservation), et les tâches ajoutées à la main. Heures de Marrakech."
    >
      <div className="mb-4 flex flex-wrap justify-end gap-2">
        <Link href="/admin/operations/nouvelle" className="inline-flex h-11 items-center gap-2 rounded-sm bg-brand px-5 font-semibold text-white hover:bg-brand-strong">
          <Plus className="size-4" aria-hidden="true" />
          Nouvelle tâche
        </Link>
      </div>

      <form method="get" role="search" aria-label="Filtrer les tâches" className="grid gap-3 rounded-lg border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_2fr_1fr_1fr_1fr_auto] lg:items-end">
        <label className="block">
          <span className="mb-1 block text-micro font-medium">À partir du</span>
          <input type="date" name="du" defaultValue={raw.du} className={field} />
        </label>
        <label className="block">
          <span className="mb-1 block text-micro font-medium">Période</span>
          <select name="jours" defaultValue={raw.jours} className={field}>
            <option value="1">1 jour</option>
            <option value="3">3 jours</option>
            <option value="7">7 jours</option>
            <option value="14">14 jours</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-micro font-medium">Bien</span>
          <select name="bien" defaultValue={raw.bien} className={field}>
            <option value="">Tous</option>
            {listings.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title} — {l.address}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-micro font-medium">Agent</span>
          <select name="agent" defaultValue={raw.agent} className={field}>
            <option value="">Tous</option>
            <option value="aucun">Non affectées</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-micro font-medium">Statut</span>
          <select name="statut" defaultValue={raw.statut} className={field}>
            <option value="">Toutes sauf annulées</option>
            {Object.entries(TASK_STATUS_PARAM).map(([k, s]) => (
              <option key={k} value={k}>
                {TASK_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-micro font-medium">Type</span>
          <select name="type" defaultValue={raw.type} className={field}>
            <option value="">Tous</option>
            {Object.entries(TASK_TYPE_PARAM).map(([k, t]) => (
              <option key={k} value={k}>
                {TASK_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="h-11 rounded-sm bg-ink px-5 font-semibold text-white hover:bg-black">
          Filtrer
        </button>
      </form>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-ink-muted" data-testid="task-count">
          {pluralize(items.length, "tâche", "tâches")}
          {unassigned > 0 && <span className="font-semibold text-error"> · {pluralize(unassigned, "non affectée", "non affectées")}</span>}
          {truncated && " (liste limitée : affinez les filtres)"}
        </p>
        <nav aria-label="Période" className="flex gap-3">
          <Link href={nav(-span)} className="font-semibold underline underline-offset-2">
            Période précédente
          </Link>
          <Link href={nav(span)} className="font-semibold underline underline-offset-2">
            Période suivante
          </Link>
        </nav>
      </div>

      {items.length === 0 ? (
        <p className="mt-3 rounded-lg border border-line bg-white p-5 text-ink-muted">Aucune tâche ne correspond à ces critères.</p>
      ) : (
        <div className="mt-3 space-y-5">
          {[...byDay].map(([d, tasks]) => (
            <section key={d} aria-labelledby={`day-${d}`} data-testid="task-day" data-day={d}>
              <h2 id={`day-${d}`} className="mb-2 text-title-s font-semibold">
                {dayHeading(d, isoDay(today))} <span className="font-normal text-ink-muted">· {pluralize(tasks.length, "tâche", "tâches")}</span>
              </h2>
              <ul className="divide-y divide-line rounded-lg border border-line bg-white">
                {tasks.map((t) => (
                  <TaskCard key={t.id} task={t} href={`/admin/operations/${t.id}`}>
                    {(t.status === "TODO" || t.status === "IN_PROGRESS") && <AssignForm compact taskId={t.id} assigneeId={t.assignee?.id ?? null} members={members} />}
                  </TaskCard>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </AdminPage>
  );
}
