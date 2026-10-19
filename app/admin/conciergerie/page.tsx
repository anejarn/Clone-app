import { ImageIcon, Plus, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { canSeePartnerPrices, PRICING_MODEL_LABEL, SERVICE_CATEGORY_LABEL, SERVICE_CATEGORY_PARAM } from "@/lib/concierge/catalog";
import { formatMad, pluralize } from "@/lib/format";
import { localizedLanguages } from "@/lib/i18n/localized";
import { bpsToPercent } from "@/lib/money";
import { requireAdminPage } from "@/lib/server/authz";
import { listServices } from "@/lib/server/concierge/admin";

export const metadata: Metadata = { title: "Conciergerie" };

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

/**
 * The conciergerie's catalogue (Lot 4b). Associés: every service with its sale price, partner price and margin, the
 * inactive ones too, and the way to the partners and to editing. Agents: the active services with their sale price
 * only (what a guest would be told), never a partner price, a margin or a partner.
 */
export default function Page({ searchParams }: PageProps<"/admin/conciergerie">) {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: Promise<Search> }) {
  const access = await requireAdminPage("/admin/conciergerie");
  const admin = canSeePartnerPrices(access.user.role);
  const sp = await searchParams;
  const categorie = Object.hasOwn(SERVICE_CATEGORY_PARAM, one(sp.categorie)) ? one(sp.categorie) : "";
  const services = await listServices(access, { category: categorie ? SERVICE_CATEGORY_PARAM[categorie] : undefined, includeInactive: true });
  const field = "h-11 w-full rounded-sm border border-ink-faint bg-white px-3 outline-none focus:border-ink focus:ring-1 focus:ring-ink";

  return (
    <AdminPage
      title="Conciergerie"
      intro={
        admin
          ? "Le catalogue des services proposés aux voyageurs dans leur guide d'accueil : prix de vente, prix partenaire et marge."
          : "Les services proposés aux voyageurs, avec leur prix de vente."
      }
    >
      {sp.supprime === "1" && (
        <p role="status" className="mb-4 rounded-sm bg-brand-tint p-3 font-medium text-brand-deep">
          Service supprimé.
        </p>
      )}
      {admin && (
        <div className="mb-4 flex flex-wrap justify-end gap-2">
          <Link href="/admin/conciergerie/gestion" className="inline-flex h-11 items-center gap-2 rounded-sm border border-ink bg-white px-5 font-semibold text-ink hover:bg-surface-2">
            <Users className="size-4" aria-hidden="true" />
            Partenaires
          </Link>
          <Link href="/admin/conciergerie/gestion/services/nouveau" className="inline-flex h-11 items-center gap-2 rounded-sm bg-brand px-5 font-semibold text-white hover:bg-brand-strong">
            <Plus className="size-4" aria-hidden="true" />
            Nouveau service
          </Link>
        </div>
      )}

      <form method="get" role="search" aria-label="Filtrer les services" className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-white p-4">
        <label className="block min-w-48 flex-1 sm:flex-none">
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

      <p className="mt-4 text-ink-muted" data-testid="service-count">
        {pluralize(services.length, "service", "services")}
      </p>
      {services.length === 0 ? (
        <p className="mt-3 rounded-lg border border-line bg-white p-5 text-ink-muted">Aucun service dans cette catégorie.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-white">
          {services.map((s) => (
            <li key={s.id} className="flex flex-col gap-2 p-3 md:flex-row md:items-start md:justify-between md:px-4" data-testid="service-row" data-active={s.active}>
              <div className="min-w-0">
                {admin ? (
                  <Link href={`/admin/conciergerie/gestion/services/${s.id}`} className="font-semibold hover:underline">
                    {s.title.fr}
                  </Link>
                ) : (
                  <p className="font-semibold">{s.title.fr}</p>
                )}
                <p className="text-caption text-ink-muted">
                  {SERVICE_CATEGORY_LABEL[s.category]} · {PRICING_MODEL_LABEL[s.pricingModel]}
                  {s.leadTimeHours > 0 && ` · ${s.leadTimeHours} h à l'avance`}
                  {admin && s.partner && ` · ${s.partner.name}`}
                  {` · ${localizedLanguages(s.title).join(", ").toUpperCase()}`}
                </p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {!s.active && <span className="rounded-pill bg-surface-3 px-2.5 py-0.5 text-micro font-semibold text-ink">Désactivé</span>}
                  {s.hasPhoto && (
                    <span className="inline-flex items-center gap-1 text-caption text-ink-muted">
                      <ImageIcon className="size-3.5" aria-hidden="true" />
                      Photo
                    </span>
                  )}
                  {s.options.length > 0 && <span className="text-caption text-ink-muted">{pluralize(s.options.length, "option", "options")}</span>}
                </div>
              </div>
              <dl className="grid shrink-0 grid-cols-3 gap-x-4 text-caption md:text-right" data-testid="service-prices">
                <div>
                  <dt className="text-ink-muted">Vente</dt>
                  <dd className="font-semibold tabular-nums">{s.salePriceCents === null ? "Sur devis" : formatMad(s.salePriceCents)}</dd>
                </div>
                {admin && (
                  <>
                    <div>
                      <dt className="text-ink-muted">Partenaire</dt>
                      <dd className="tabular-nums">{s.partnerPriceCents === null ? "—" : formatMad(s.partnerPriceCents)}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-muted">Marge</dt>
                      <dd className="font-semibold tabular-nums" data-testid="service-margin">
                        {s.marginCents === null ? "—" : `${formatMad(s.marginCents)}${s.marginBps === null ? "" : ` (${bpsToPercent(s.marginBps)} %)`}`}
                      </dd>
                    </div>
                  </>
                )}
              </dl>
            </li>
          ))}
        </ul>
      )}
      {admin && (
        <p className="mt-4">
          <Link href="/admin/conciergerie/demandes" className="font-semibold underline underline-offset-2">
            Voir les demandes des voyageurs
          </Link>
        </p>
      )}
    </AdminPage>
  );
}
