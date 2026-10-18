import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { ManualTaskForm } from "@/components/admin/tasks/TaskForms";
import { isoDay } from "@/lib/admin/calendar";
import { requireAdminPage } from "@/lib/server/authz";
import { taskAssignees, tasksToday, taskListings } from "@/lib/server/operations/tasks";

export const metadata: Metadata = { title: "Nouvelle tâche" };

export default function Page({ searchParams }: PageProps<"/admin/operations/nouvelle">) {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { organizationId } = await requireAdminPage("/admin/operations");
  const sp = await searchParams;
  const [listings, members] = await Promise.all([taskListings(organizationId), taskAssignees(organizationId)]);
  const bien = typeof sp.bien === "string" && listings.some((l) => l.id === sp.bien) ? sp.bien : undefined;
  return (
    <AdminPage
      title="Nouvelle tâche"
      intro={
        <>
          <Link href="/admin/operations" className="underline underline-offset-2">
            Opérations
          </Link>{" "}
          · Une tâche hors réservation : courses, petite réparation, ménage après le séjour d&apos;un propriétaire… La check-list du type choisi est copiée sur la tâche.
        </>
      }
    >
      <ManualTaskForm listings={listings} members={members} defaults={{ day: isoDay(tasksToday()), listingId: bien }} />
    </AdminPage>
  );
}
