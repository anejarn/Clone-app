import { Camera, Plus, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { TicketBadges } from "@/components/admin/tickets/TicketBadges";
import { formatDateTime, pluralize } from "@/lib/format";
import { managesTickets, TICKET_CATEGORY_LABEL, TICKET_CATEGORY_PARAM, TICKET_PRIORITY_LABEL, TICKET_PRIORITY_PARAM, TICKET_STATUS_LABEL, TICKET_STATUS_PARAM } from "@/lib/operations/tickets";
import { requireAdminPage } from "@/lib/server/authz";
import { taskAssignees } from "@/lib/server/operations/tasks";
import { listTickets, ticketListings } from "@/lib/server/operations/tickets";

export const metadata: Metadata = { title: "Pannes" };

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
const pick = <T extends Record<string, string>>(map: T, v: string): T[keyof T] | undefined => (Object.hasOwn(map, v) ? map[v as keyof T] : undefined);

/**
 * Breakdown reports. Associés: every ticket of the organization, with filters (status, priority, category, home,
 * assignee). Agents: the tickets they reported or are assigned to.
 */
export default function Page({ searchParams }: PageProps<"/admin/pannes">) {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: Promise<Search> }) {
  const access = await requireAdminPage("/admin/pannes");
  const manage = managesTickets(access.user.role);
  const sp = await searchParams;
  const [listings, members] = manage ? await Promise.all([ticketListings(access.organizationId), taskAssignees(access.organizationId)]) : [[], []];
  const raw = {
    statut: Object.hasOwn(TICKET_STATUS_PARAM, one(sp.statut)) ? one(sp.statut) : "ouvertes",
    priorite: Object.hasOwn(TICKET_PRIORITY_PARAM, one(sp.priorite)) ? one(sp.priorite) : "",
    categorie: Object.hasOwn(TICKET_CATEGORY_PARAM, one(sp.categorie)) ? one(sp.categorie) : "",
    bien: listings.some((l) => l.id === one(sp.bien)) ? one(sp.bien) : "",
    agent: one(sp.agent) === "aucun" || members.some((m) => m.id === one(sp.agent)) ? one(sp.agent) : "",
  };
  const { items, truncated } = await listTickets(access, {
    status: pick(TICKET_STATUS_PARAM, raw.statut),
    priority: pick(TICKET_PRIORITY_PARAM, raw.priorite),
    category: pick(TICKET_CATEGORY_PARAM, raw.categorie),
    listingId: raw.bien || undefined,
    assignee: raw.agent === "aucun" ? "none" : raw.agent || undefined,
  });
  const field = "h-11 w-full rounded-sm border border-ink-faint bg-white px-3 outline-none focus:border-ink focus:ring-1 focus:ring-ink";
  const STATUS_OPTIONS: Record<string, string> = { ouvertes: "À traiter (signalées, en cours, en attente)", ...Object.fromEntries(Object.entries(TICKET_STATUS_PARAM).filter(([, s]) => s in TICKET_STATUS_LABEL).map(([k, s]) => [k, TICKET_STATUS_LABEL[s as keyof typeof TICKET_STATUS_LABEL]])), toutes: "Toutes" };

  return (
    <AdminPage
      title="Pannes"
      intro={manage ? "Les pannes signalées sur les biens, de la plus urgente à la moins urgente, suivies jusqu'à la réparation." : "Les pannes que vous avez signalées et celles qui vous sont confiées."}
    >
      <div className="mb-4 flex flex-wrap justify-end gap-2">
        <Link href="/admin/pannes/nouvelle" className="inline-flex h-11 items-center gap-2 rounded-sm bg-brand px-5 font-semibold text-white hover:bg-brand-strong">
          <Plus className="size-4" aria-hidden="true" />
          Signaler une panne
        </Link>
      </div>

      <form method="get" role="search" aria-label="Filtrer les pannes" className="grid gap-3 rounded-lg border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_2fr_1fr_auto] lg:items-end">
        <label className="block">
          <span className="mb-1 block text-micro font-medium">Statut</span>
          <select name="statut" defaultValue={raw.statut} className={field}>
            {Object.entries(STATUS_OPTIONS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-micro font-medium">Priorité</span>
          <select name="priorite" defaultValue={raw.priorite} className={field}>
            <option value="">Toutes</option>
            {Object.entries(TICKET_PRIORITY_PARAM).map(([k, p]) => (
              <option key={k} value={k}>
                {TICKET_PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-micro font-medium">Catégorie</span>
          <select name="categorie" defaultValue={raw.categorie} className={field}>
            <option value="">Toutes</option>
            {Object.entries(TICKET_CATEGORY_PARAM).map(([k, c]) => (
              <option key={k} value={k}>
                {TICKET_CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
        {manage && (
          <>
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
              <span className="mb-1 block text-micro font-medium">Confiée à</span>
              <select name="agent" defaultValue={raw.agent} className={field}>
                <option value="">Tous</option>
                <option value="aucun">Personne</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <button type="submit" className="h-11 rounded-sm bg-ink px-5 font-semibold text-white hover:bg-black">
          Filtrer
        </button>
      </form>

      <p className="mt-4 text-ink-muted" data-testid="ticket-count">
        {pluralize(items.length, "panne", "pannes")}
        {truncated && " (liste limitée : affinez les filtres)"}
      </p>

      {items.length === 0 ? (
        <p className="mt-3 rounded-lg border border-line bg-white p-5 text-ink-muted">Aucune panne ne correspond à ces critères.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-white">
          {items.map((t) => (
            <li key={t.id} className="flex flex-col gap-2 p-3 md:flex-row md:items-start md:justify-between md:px-4" data-testid="ticket-row" data-priority={t.priority} data-status={t.status}>
              <div className="min-w-0">
                <Link href={`/admin/pannes/${t.id}`} className="font-semibold hover:underline">
                  {t.title}
                </Link>
                <p className="truncate text-caption text-ink-muted">
                  {t.listing.title} · {TICKET_CATEGORY_LABEL[t.category]} · signalée le {formatDateTime(new Date(t.createdAt))}
                  {t.reporter && ` par ${t.reporter.name}`}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <TicketBadges ticket={t} />
                  {t.photoCount > 0 && (
                    <span className="inline-flex items-center gap-1 text-caption text-ink-muted">
                      <Camera className="size-3.5" aria-hidden="true" />
                      {pluralize(t.photoCount, "photo", "photos")}
                    </span>
                  )}
                </div>
              </div>
              <p className="flex shrink-0 items-center gap-1.5 text-caption" data-testid="ticket-assignee">
                <UserRound className="size-3.5" aria-hidden="true" />
                {t.assignee ? t.assignee.name : <span className="text-ink-muted">Personne</span>}
              </p>
            </li>
          ))}
        </ul>
      )}
    </AdminPage>
  );
}
