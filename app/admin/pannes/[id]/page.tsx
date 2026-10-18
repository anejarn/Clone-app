import { CheckCircle2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { TicketBadges } from "@/components/admin/tickets/TicketBadges";
import { CommentForm, CostForm, PriorityForm, StatusForm, TicketAssignForm, TicketPhotoForm } from "@/components/admin/tickets/TicketForms";
import { formatDateTime, formatPrice } from "@/lib/format";
import { centimesToDirhams } from "@/lib/money";
import { TICKET_CATEGORY_LABEL, TICKET_PRIORITY_LABEL, ticketStatusText, type TicketPriorityKey, type TicketStatusKey, type TicketWaitingKey } from "@/lib/operations/tickets";
import { requireAdminPage } from "@/lib/server/authz";
import { taskAssignees } from "@/lib/server/operations/tasks";
import { getTicket, type TicketEventView } from "@/lib/server/operations/tickets";
import { ID_RE } from "@/lib/server/schemas";

export const metadata: Metadata = { title: "Panne" };

export default function Page({ params, searchParams }: PageProps<"/admin/pannes/[id]">) {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content params={params} searchParams={searchParams} />
    </Suspense>
  );
}

const str = (v: unknown) => (typeof v === "string" ? v : null);

/** One line of the thread, in French. */
function describe(e: TicketEventView): string {
  const d = e.details;
  switch (e.kind) {
    case "CREATED":
      return `a signalé la panne (priorité ${TICKET_PRIORITY_LABEL[(str(d.priority) ?? "NORMAL") as TicketPriorityKey]?.toLowerCase() ?? "?"})`;
    case "COMMENT":
      return "a commenté";
    case "STATUS":
      return `a passé la panne à « ${ticketStatusText((str(d.to) ?? "OPEN") as TicketStatusKey, str(d.waitingFor) as TicketWaitingKey | null)} »`;
    case "ASSIGNED":
      return d.to ? `a confié la panne à ${str(d.toName) ?? "un membre de l'équipe"}` : "a retiré l'affectation";
    case "PRIORITY":
      return `a changé la priorité : ${TICKET_PRIORITY_LABEL[str(d.from) as TicketPriorityKey] ?? "?"} → ${TICKET_PRIORITY_LABEL[str(d.to) as TicketPriorityKey] ?? "?"}`;
    case "COST": {
      const to = (d.to ?? {}) as { costCents?: number | null; rechargeOwner?: boolean };
      return typeof to.costCents === "number" ? `a indiqué le coût : ${formatPrice(to.costCents)}${to.rechargeOwner ? " (à refacturer au propriétaire)" : ""}` : "a retiré le coût";
    }
    case "PHOTO":
      return "a ajouté une photo";
  }
}

async function Content({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireAdminPage("/admin/pannes");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  // Another organization's ticket, or for an agent one that isn't theirs: "not found", as an unknown one.
  const ticket = ID_RE.test(id) ? await getTicket(access, id) : null;
  if (!ticket) notFound();
  const members = ticket.can.manage ? await taskAssignees(access.organizationId) : [];

  return (
    <AdminPage
      title={ticket.title}
      intro={
        <Link href="/admin/pannes" className="underline underline-offset-2">
          Pannes
        </Link>
      }
    >
      <div className="space-y-5">
        {sp.cree === "1" && (
          <p role="status" className="flex items-center gap-2 rounded-lg border border-line bg-brand-tint p-4 font-medium text-brand-deep">
            <CheckCircle2 className="size-5 shrink-0" aria-hidden="true" />
            Panne signalée. Elle est suivie jusqu&apos;à sa réparation.
          </p>
        )}
        <section className="rounded-lg border border-line bg-white p-4 md:p-6">
          <dl className="grid gap-3 sm:grid-cols-2" data-testid="ticket-facts">
            <div>
              <dt className="text-micro font-medium text-ink-muted">Logement</dt>
              <dd>
                <p className="font-semibold">{ticket.listing.title}</p>
                <p className="text-caption text-ink-muted">{ticket.listing.address}</p>
              </dd>
            </div>
            <div>
              <dt className="text-micro font-medium text-ink-muted">Statut</dt>
              <dd className="mt-1">
                <TicketBadges ticket={ticket} />
              </dd>
            </div>
            <div>
              <dt className="text-micro font-medium text-ink-muted">Catégorie</dt>
              <dd>{TICKET_CATEGORY_LABEL[ticket.category]}</dd>
            </div>
            <div>
              <dt className="text-micro font-medium text-ink-muted">Signalée</dt>
              <dd>
                le {formatDateTime(new Date(ticket.createdAt))}
                {ticket.reporter && ` par ${ticket.reporter.name}`}
              </dd>
            </div>
            <div>
              <dt className="text-micro font-medium text-ink-muted">Confiée à</dt>
              <dd data-testid="ticket-assignee">{ticket.assignee?.name ?? "Personne"}</dd>
            </div>
            {ticket.resolvedAt && (
              <div>
                <dt className="text-micro font-medium text-ink-muted">Réparée</dt>
                <dd>le {formatDateTime(new Date(ticket.resolvedAt))}</dd>
              </div>
            )}
            {ticket.task && (
              <div>
                <dt className="text-micro font-medium text-ink-muted">Pendant la tâche</dt>
                <dd>
                  <Link href={ticket.can.manage ? `/admin/operations/${ticket.task.id}` : `/admin/mes-taches/${ticket.task.id}`} className="underline underline-offset-2">
                    {ticket.task.title}
                  </Link>
                </dd>
              </div>
            )}
            {ticket.bookingId && ticket.can.manage && (
              <div>
                <dt className="text-micro font-medium text-ink-muted">Séjour</dt>
                <dd>
                  <Link href={`/admin/reservations/${ticket.bookingId}`} className="underline underline-offset-2">
                    Voir la réservation
                  </Link>
                </dd>
              </div>
            )}
            {ticket.cost && ticket.cost.cents !== null && (
              <div>
                <dt className="text-micro font-medium text-ink-muted">Coût</dt>
                <dd data-testid="ticket-cost">
                  {formatPrice(ticket.cost.cents)}
                  {ticket.cost.rechargeOwner && " · à refacturer au propriétaire"}
                </dd>
              </div>
            )}
            {ticket.description && (
              <div className="sm:col-span-2">
                <dt className="text-micro font-medium text-ink-muted">Détails</dt>
                <dd className="whitespace-pre-line">{ticket.description}</dd>
              </div>
            )}
          </dl>
        </section>

        <section aria-labelledby="photos-title" className="rounded-lg border border-line bg-white p-4 md:p-6">
          <h2 id="photos-title" className="mb-3 text-title-s font-semibold">
            Photos <span className="font-normal text-ink-muted">({ticket.photos.length})</span>
          </h2>
          {ticket.photos.length > 0 && (
            <ul className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="ticket-photos">
              {ticket.photos.map((p, i) => (
                <li key={p.id}>
                  <a href={p.url} target="_blank" rel="noreferrer">
                    {/* Plain <img>: ticket photos are staff-only (app/media), which the image optimizer can't fetch. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt={`${ticket.title}, photo ${i + 1}`} className="aspect-[4/3] w-full rounded-sm border border-line object-cover" loading="lazy" />
                  </a>
                </li>
              ))}
            </ul>
          )}
          {ticket.status !== "CANCELLED" && <TicketPhotoForm ticketId={ticket.id} />}
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          {ticket.can.statuses.length > 0 && <StatusForm ticketId={ticket.id} status={ticket.status} waitingFor={ticket.waitingFor} statuses={ticket.can.statuses} />}
          {ticket.can.manage && <TicketAssignForm ticketId={ticket.id} assigneeId={ticket.assignee?.id ?? null} members={members} />}
          {ticket.can.manage && <PriorityForm ticketId={ticket.id} priority={ticket.priority} />}
          {ticket.can.manage && ticket.cost && (
            <CostForm ticketId={ticket.id} cost={ticket.cost.cents === null ? "" : centimesToDirhams(ticket.cost.cents)} rechargeOwner={ticket.cost.rechargeOwner} />
          )}
        </div>

        <section aria-labelledby="thread-title" className="space-y-3">
          <h2 id="thread-title" className="text-title-s font-semibold">
            Suivi
          </h2>
          <ol className="divide-y divide-line rounded-lg border border-line bg-white" data-testid="ticket-thread">
            {ticket.events.map((e) => (
              <li key={e.id} className="p-3 md:px-4" data-kind={e.kind}>
                <p className="text-caption text-ink-muted">
                  <time dateTime={e.createdAt}>{formatDateTime(new Date(e.createdAt))}</time>
                </p>
                <p>
                  <strong>{e.author ?? "Ancien membre"}</strong> {describe(e)}
                </p>
                {e.body && <p className="mt-1 whitespace-pre-line rounded-sm bg-surface-2 p-2">{e.body}</p>}
              </li>
            ))}
          </ol>
          <CommentForm ticketId={ticket.id} />
        </section>
      </div>
    </AdminPage>
  );
}
