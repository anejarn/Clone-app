import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { LicenseBadge, ManagementBadge, StatusBadge } from "@/components/admin/listings/Badges";
import type { LicenseStatus } from "@/lib/admin/license";
import { formatPrice, pluralize } from "@/lib/format";
import { PROPERTY_TYPE_LABEL, type PropertyTypeKey } from "@/lib/labels";
import { listAdminListings, type ListingFilters } from "@/lib/server/admin/listings";
import { requireAdminPage } from "@/lib/server/authz";

export const metadata: Metadata = { title: "Biens" };

/** URL values of the filters (French, readable in the address bar) and what they mean. */
const STATUS = { brouillon: "DRAFT", publie: "PUBLISHED" } as const;
const MANAGEMENT = { mandat: "MANAGED", "sous-location": "SUBLEASE" } as const;
const LICENSE = { manquante: "MISSING", expiree: "EXPIRED", "expire-bientot": "EXPIRING", valide: "VALID" } as const satisfies Record<string, LicenseStatus>;

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
const pick = <T extends Record<string, string>>(map: T, v: string): T[keyof T] | undefined => (Object.hasOwn(map, v) ? map[v as keyof T] : undefined);

export default function Page({ searchParams }: PageProps<"/admin/biens">) {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: Promise<Search> }) {
  const { organizationId } = await requireAdminPage("/admin/biens");
  const sp = await searchParams;
  const raw = { q: one(sp.q).slice(0, 100), statut: one(sp.statut), gestion: one(sp.gestion), autorisation: one(sp.autorisation) };
  const filters: ListingFilters = {
    q: raw.q || undefined,
    status: pick(STATUS, raw.statut),
    managementType: pick(MANAGEMENT, raw.gestion),
    license: pick(LICENSE, raw.autorisation),
    page: Math.min(1000, Math.max(1, Number.parseInt(one(sp.page), 10) || 1)),
  };
  const { items, total, page, pageCount } = await listAdminListings(organizationId, filters);
  const pageHref = (p: number) => `/admin/biens?${new URLSearchParams({ ...Object.fromEntries(Object.entries(raw).filter(([, v]) => v)), page: String(p) })}`;
  const select = "h-11 w-full rounded-sm border border-ink-faint bg-white px-3 outline-none focus:border-ink focus:ring-1 focus:ring-ink";

  return (
    <AdminPage title="Biens" intro="Les logements gérés par l'organisation : fiche, photos, propriétaire, conditions de gestion et autorisation loi 80-14.">
      <div className="mb-4 flex justify-end">
        <Link href="/admin/biens/nouveau" className="inline-flex h-11 items-center gap-2 rounded-sm bg-brand px-5 font-semibold text-white hover:bg-brand-strong">
          <Plus className="size-4" aria-hidden="true" />
          Nouveau bien
        </Link>
      </div>

      <form method="get" role="search" aria-label="Filtrer les biens" className="grid gap-3 rounded-lg border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto] lg:items-end">
        <label className="block">
          <span className="mb-1 block text-micro font-medium">Recherche</span>
          <input name="q" type="search" defaultValue={raw.q} placeholder="Titre ou adresse" className={select} />
        </label>
        <label className="block">
          <span className="mb-1 block text-micro font-medium">Statut</span>
          <select name="statut" defaultValue={raw.statut} className={select}>
            <option value="">Tous</option>
            <option value="publie">Publié</option>
            <option value="brouillon">Brouillon</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-micro font-medium">Type de gestion</span>
          <select name="gestion" defaultValue={raw.gestion} className={select}>
            <option value="">Tous</option>
            <option value="mandat">Mandat de gestion</option>
            <option value="sous-location">Sous-location</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-micro font-medium">Autorisation 80-14</span>
          <select name="autorisation" defaultValue={raw.autorisation} className={select}>
            <option value="">Toutes</option>
            <option value="expiree">Expirée</option>
            <option value="expire-bientot">Expire sous 60 jours</option>
            <option value="manquante">Manquante</option>
            <option value="valide">Valide</option>
          </select>
        </label>
        <button type="submit" className="h-11 rounded-sm bg-ink px-5 font-semibold text-white hover:bg-black">
          Filtrer
        </button>
      </form>

      <p className="mt-4 text-ink-muted" data-testid="listing-count">
        {pluralize(total, "bien", "biens")}
        {pageCount > 1 && ` · page ${page} sur ${pageCount}`}
      </p>

      {items.length === 0 ? (
        <p className="mt-3 rounded-lg border border-line bg-white p-5 text-ink-muted">Aucun bien ne correspond à ces critères.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-white" data-testid="listing-rows">
          {items.map((l) => (
            <li key={l.id} className="flex gap-3 p-3 md:gap-4 md:p-4">
              <div className="h-16 w-20 shrink-0 overflow-hidden rounded-sm bg-surface-3 md:h-20 md:w-28">
                {l.coverUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={l.coverUrl} alt="" className="size-full object-cover" loading="lazy" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-col gap-1 md:flex-row md:items-start md:justify-between md:gap-4">
                  <Link href={`/admin/biens/${l.id}`} className="min-w-0 font-semibold hover:underline">
                    <span className="line-clamp-2">{l.title}</span>
                  </Link>
                  <p className="shrink-0 text-body">
                    {formatPrice(l.priceCents)} <span className="text-ink-muted">/ nuit</span>
                  </p>
                </div>
                <p className="mt-0.5 truncate text-caption text-ink-muted">
                  {l.propertyType ? PROPERTY_TYPE_LABEL[l.propertyType as PropertyTypeKey] : "Logement"} · {l.placeName} · {l.ownerName}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <StatusBadge status={l.status} />
                  <ManagementBadge type={l.managementType} commissionBps={l.commissionBps} />
                  <LicenseBadge state={l.license} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {pageCount > 1 && (
        <nav aria-label="Pages" className="mt-4 flex items-center justify-between gap-3">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="font-semibold underline underline-offset-2">
              Page précédente
            </Link>
          ) : (
            <span />
          )}
          {page < pageCount && (
            <Link href={pageHref(page + 1)} className="font-semibold underline underline-offset-2">
              Page suivante
            </Link>
          )}
        </nav>
      )}
    </AdminPage>
  );
}
