import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { RequestStatusBadge } from "@/components/admin/concierge/RequestStatusBadge";
import { PAYMENT_METHOD_LABEL, REQUEST_STATUS_LABEL, REQUEST_STATUS_PARAM, SERVICE_CATEGORY_LABEL, SERVICE_CATEGORY_PARAM } from "@/lib/concierge/catalog";
import { formatDate, formatMad, pluralize } from "@/lib/format";
import { formatTimeOfDay } from "@/lib/operations/schedule";
import { requireAdminPage } from "@/lib/server/authz";
import { listRequests } from "@/lib/server/concierge/requests";

export const metadata: Metadata = { title: "Demandes de services" };

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
const day = (iso: string) => formatDate(new Date(`${iso}T00:00:00Z`));

/** Guests' service requests from the welcome guide (associés): to send to the partner, follow and record as paid. */
export default function Page({ searchParams }: PageProps<"/admin/conciergerie/demandes">) {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: Promise<Search> }) {
  const access = await requireAdminPage("/admin/conciergerie/demandes");
  const sp = await searchParams;
  const statut = one(sp.statut) === "toutes" || Object.hasOwn(REQUEST_STATUS_PARAM, one(sp.statut)) ? one(sp.statut) : "";
  const categorie = Object.hasOwn(SERVICE_CATEGORY_PARAM, one(sp.categorie)) ? one(sp.categorie) : "";
  const { items, truncated } = await listRequests(access, {
    status: statut === "toutes" ? "ALL" : statut ? REQUEST_STATUS_PARAM[statut] : "OPEN_ANY",
    category: categorie ? SERVICE_CATEGORY_PARAM[categorie] : undefined,
  });
  const field = "h-11 w-full rounded-sm border border-ink-faint bg-white px-3 outline-none focus:border-ink focus:ring-1 focus:ring-ink";

  return (
    <AdminPage title="Demandes de services" intro="Les demandes des voyageurs depuis leur guide d'accueil, de la plus proche à la plus lointaine.">
      <form method="get" role="search" aria-label="Filtrer les demandes" className="grid gap-3 rounded-lg border border-line bg-white p-4 sm:grid-cols-[2fr_2fr_auto] sm:items-end">
        <label className="block">
          <span className="mb-1 block text-micro font-medium">Statut</span>
          <select name="statut" defaultValue={statut} className={field}>
            <option value="">À suivre (nouvelles, transmises, confirmées)</option>
            {Object.entries(REQUEST_STATUS_PARAM).map(([k, s]) => (
              <option key={k} value={k}>
                {REQUEST_STATUS_LABEL[s]}
              </option>
            ))}
            <option value="toutes">Toutes</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-micro font-medium">Catégorie</span>
          <select name="categorie" defaultValue={categorie} className={field}>
            <option value="">Toutes</option>
            {Object.entries(SERVICE_CATEGORY_PARAM).map(([k, c]) => (
              <option key={k} value={k}>
                {SERVICE_CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="h-11 rounded-sm bg-ink px-5 font-semibold text-white hover:bg-black">
          Filtrer
        </button>
      </form>

      <p className="mt-4 text-ink-muted" data-testid="request-count">
        {pluralize(items.length, "demande", "demandes")}
        {truncated && " (liste limitée : affinez les filtres)"}
      </p>
      {items.length === 0 ? (
        <p className="mt-3 rounded-lg border border-line bg-white p-5 text-ink-muted">Aucune demande ne correspond à ces critères.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-white">
          {items.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 p-3 md:flex-row md:items-start md:justify-between md:px-4" data-testid="request-row" data-status={r.status}>
              <div className="min-w-0">
                <Link href={`/admin/conciergerie/demandes/${r.id}`} className="font-semibold hover:underline">
                  {r.title} · {day(r.serviceDate)} à {formatTimeOfDay(r.startMinutes)}
                </Link>
                <p className="truncate text-caption text-ink-muted">
                  Réf. {r.reference} · {r.booking.guestName ?? "Voyageur"} · {r.booking.listing.title} · {r.partner.name} · {pluralize(r.persons, "personne", "personnes")}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <RequestStatusBadge status={r.status} />
                  {r.paidAt && <span className="rounded-pill bg-[#e6f4e7] px-2.5 py-0.5 text-micro font-semibold text-[#0b5e0f]">Payée · {PAYMENT_METHOD_LABEL[r.paymentMethod!]}</span>}
                </div>
              </div>
              <dl className="grid shrink-0 grid-cols-2 gap-x-4 text-caption md:text-right">
                <div>
                  <dt className="text-ink-muted">Vente</dt>
                  <dd className="font-semibold tabular-nums">{r.saleTotalCents === null ? "Devis" : formatMad(r.saleTotalCents)}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Marge</dt>
                  <dd className="tabular-nums">{r.marginCents === null ? "—" : formatMad(r.marginCents)}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </AdminPage>
  );
}
