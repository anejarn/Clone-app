import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { NewTicketForm } from "@/components/admin/tickets/TicketForms";
import { TASK_TYPE_TITLE } from "@/lib/operations/labels";
import { requireAdminPage } from "@/lib/server/authz";
import { ticketListings, ticketSourceTask } from "@/lib/server/operations/tickets";
import { ID_RE } from "@/lib/server/schemas";

export const metadata: Metadata = { title: "Signaler une panne" };

/** A new breakdown report, on a home, or from a task (?tache=<id>: an agent only from their own tasks). */
export default function Page({ searchParams }: PageProps<"/admin/pannes/nouvelle">) {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireAdminPage("/admin/pannes");
  const sp = await searchParams;
  const taskId = typeof sp.tache === "string" ? sp.tache : "";
  const task = taskId ? (ID_RE.test(taskId) ? await ticketSourceTask(access, taskId) : null) : undefined;
  if (task === null) notFound();
  const listings = task ? [] : await ticketListings(access.organizationId);
  const bien = typeof sp.bien === "string" && listings.some((l) => l.id === sp.bien) ? sp.bien : undefined;

  return (
    <AdminPage
      title="Signaler une panne"
      intro={
        <>
          Décrivez ce qui ne marche pas et prenez une photo : la panne est suivie jusqu&apos;à sa réparation.{" "}
          <Link href="/admin/pannes" className="underline underline-offset-2">
            Toutes les pannes
          </Link>
        </>
      }
    >
      <div className="max-w-2xl">
        <NewTicketForm
          listings={listings}
          defaultListingId={bien}
          task={task ? { id: task.id, label: `${task.title ?? TASK_TYPE_TITLE[task.type]} · ${task.listing.title}` } : undefined}
        />
      </div>
    </AdminPage>
  );
}
