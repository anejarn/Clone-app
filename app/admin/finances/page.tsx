import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { MonthClosing } from "@/components/admin/finances/FinanceForms";
import { FinanceTabs, mad } from "@/components/admin/finances/FinanceViews";
import { SOURCE_LABEL } from "@/lib/admin/booking-sources";
import { formatDate } from "@/lib/format";
import { MANAGEMENT_LABEL, SPLIT_STATUS_LABEL } from "@/lib/finance/labels";
import type { MonthTotals } from "@/lib/finance/ledger";
import { addMonths, isMonth, localMonth, monthLabel } from "@/lib/finance/months";
import { requireAdminPage } from "@/lib/server/authz";
import { incompleteSplits } from "@/lib/server/finance/bookings";
import { monthOverview } from "@/lib/server/finance/ledger";

export const metadata: Metadata = { title: "Finances" };

/** The month's figures by home and by owner, from the journal (ADMIN), with the closing of the month. */
export default function Page({ searchParams }: PageProps<"/admin/finances">) {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

const day = (iso: string) => formatDate(new Date(`${iso}T00:00:00Z`));

function Totals({ t, projectedRent }: { t: MonthTotals; projectedRent: number }) {
  return (
    <>
      <td className="px-3 py-2 text-right">{mad(t.grossCents)}</td>
      <td className="px-3 py-2 text-right">{mad(t.platformFeeCents)}</td>
      <td className="px-3 py-2 text-right">{mad(t.commissionCents)}</td>
      <td className="px-3 py-2 text-right">{mad(t.ownerShareCents + t.cleaningOwnerCents)}</td>
      <td className="px-3 py-2 text-right">{mad(t.expensesRebilledCents - t.ownerAdvancesCents)}</td>
      <td className="px-3 py-2 text-right">
        {mad(t.subleaseRentCents + projectedRent)}
        {projectedRent > 0 && <span className="block text-caption text-ink-muted">prévu</span>}
      </td>
      <td className="px-3 py-2 text-right font-semibold" data-testid="net-due">
        {mad(t.netDueOwnerCents + projectedRent)}
      </td>
    </>
  );
}

const HEAD = ["Revenu brut", "Frais plateformes", "Commission", "Part propriétaire (ménage compris)", "Dépenses refacturées (− avances)", "Loyer sous-location", "Net dû au propriétaire"];

async function Content({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireAdminPage("/admin/finances");
  const sp = await searchParams;
  const current = localMonth(new Date());
  const month = isMonth(sp.mois) ? sp.mois : addMonths(current, -1);
  const [o, incomplete] = await Promise.all([monthOverview(access.organizationId, month), incompleteSplits(access.organizationId)]);
  const label = monthLabel(month);
  const warnings = [
    ...(o.incomplete ? [`${o.incomplete} séjour(s) du mois sans montant ou sans taux`] : []),
    ...(o.draftExpenses ? [`${o.draftExpenses} dépense(s) du mois encore en brouillon`] : []),
  ];
  const nav = "inline-flex h-11 items-center rounded-sm border border-line bg-white px-4 font-medium hover:bg-surface-2";
  return (
    <AdminPage title={`Finances · ${label}`} intro="Répartition de chaque séjour, dépenses, net dû à chaque propriétaire, clôture du mois. Montants en dirhams, d'après le journal des écritures.">
      <FinanceTabs current="/admin/finances" />
      <div className="space-y-6">
        <nav aria-label="Mois" className="flex flex-wrap items-center gap-3">
          <Link href={`/admin/finances?mois=${addMonths(month, -1)}`} className={nav}>
            ← {monthLabel(addMonths(month, -1))}
          </Link>
          {month < current && (
            <Link href={`/admin/finances?mois=${addMonths(month, 1)}`} className={nav}>
              {monthLabel(addMonths(month, 1))} →
            </Link>
          )}
          <a href={`/api/admin/finances/export?du=${month}&au=${month}`} className="inline-flex h-11 items-center gap-2 rounded-sm border border-ink bg-white px-4 font-semibold hover:bg-surface-2" data-testid="month-csv">
            <Download className="size-4" aria-hidden="true" />
            Export comptable (CSV)
          </a>
          <span className={`rounded-full px-3 py-1 text-caption font-semibold ${o.closed ? "bg-ink text-white" : "bg-surface-2"}`} data-testid="month-status">
            {o.closed ? "Clôturé" : "Ouvert"}
          </span>
        </nav>

        <section className="rounded-lg border border-line bg-white p-4 md:p-6" aria-labelledby="sigma-title">
          <h2 id="sigma-title" className="text-title-s font-semibold">
            Sigma ce mois-ci
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="month-totals">
            {[
              ["Revenu brut des séjours", o.totals.grossCents],
              ["Commission", o.totals.commissionCents],
              ["Ménage gardé par Sigma", o.totals.cleaningSigmaCents],
              ["Sous-location (revenu)", o.totals.sigmaRentalCents],
              ["Marge conciergerie", o.totals.serviceMarginCents],
              ["Dépenses à la charge de Sigma", o.totals.expensesSigmaCents],
              ["Taxe de séjour à reverser", o.totals.touristTaxCents],
              ["Résultat Sigma", o.totals.sigmaResultCents],
            ].map(([k, v]) => (
              <div key={k as string}>
                <dt className="text-caption text-ink-muted">{k}</dt>
                <dd className="font-semibold">{mad(v as number)}</dd>
              </div>
            ))}
          </dl>
          {o.totals.adjustmentsAfterClosingCents !== 0 && (
            <p className="mt-3 text-caption text-ink-muted">Dont {mad(o.totals.adjustmentsAfterClosingCents)} d&apos;ajustements de mois déjà clôturés.</p>
          )}
          <p className="mt-3 text-caption text-ink-muted">
            Frais de plateforme estimés tant que le vrai montant n&apos;est pas connu ; règles de répartition à confirmer avec le comptable (Paramètres).
          </p>
          <div className="mt-4">
            <MonthClosing month={month} label={label} closed={o.closed} closable={o.closable} warnings={warnings} />
          </div>
        </section>

        <section aria-labelledby="owners-title">
          <h2 id="owners-title" className="mb-3 text-title-s font-semibold">
            Par propriétaire
          </h2>
          <div className="overflow-x-auto rounded-lg border border-line bg-white">
            <table className="w-full min-w-[960px] text-body" data-testid="owners-table">
              <thead>
                <tr className="border-b border-line text-left text-caption text-ink-muted">
                  <th className="px-3 py-2 font-medium">Propriétaire</th>
                  {HEAD.map((h) => (
                    <th key={h} className="px-3 py-2 text-right font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {o.owners.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-4 text-ink-muted">
                      Aucune écriture ce mois-ci.
                    </td>
                  </tr>
                )}
                {o.owners.map((w) => (
                  <tr key={w.ownerId} className="border-t border-line-soft" data-testid="owner-row" data-owner={w.ownerId}>
                    <td className="px-3 py-2">
                      {w.ownerName}
                      <span className="block text-caption text-ink-muted">{w.listings} bien(s)</span>
                    </td>
                    <Totals t={w.totals} projectedRent={w.projectedRentCents} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="listings-title">
          <h2 id="listings-title" className="mb-3 text-title-s font-semibold">
            Par bien
          </h2>
          <div className="overflow-x-auto rounded-lg border border-line bg-white">
            <table className="w-full min-w-[960px] text-body" data-testid="listings-table">
              <thead>
                <tr className="border-b border-line text-left text-caption text-ink-muted">
                  <th className="px-3 py-2 font-medium">Bien</th>
                  {HEAD.map((h) => (
                    <th key={h} className="px-3 py-2 text-right font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {o.listings.map((l) => (
                  <tr key={l.listingId} className="border-t border-line-soft" data-testid="listing-row" data-listing={l.listingId}>
                    <td className="px-3 py-2">
                      {l.title}
                      <span className="block text-caption text-ink-muted">
                        {MANAGEMENT_LABEL[l.managementType]} · {l.ownerName}
                      </span>
                    </td>
                    <Totals t={l.totals} projectedRent={l.projectedRentCents} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {incomplete.length > 0 && (
          <section aria-labelledby="incomplete-title" data-testid="incomplete-splits">
            <h2 id="incomplete-title" className="mb-3 text-title-s font-semibold">
              Réservations à compléter
            </h2>
            <ul className="divide-y divide-line-soft rounded-lg border border-line bg-white">
              {incomplete.map((r) => (
                <li key={r.bookingId} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <span>
                    {r.listingTitle} · {SOURCE_LABEL[r.source]} {r.externalRef ?? ""} · du {day(r.checkIn)} au {day(r.checkOut)}
                    <span className="block text-caption text-error">{SPLIT_STATUS_LABEL[r.status]}</span>
                  </span>
                  <Link href={`/admin/reservations/${r.bookingId}`} className="font-semibold underline underline-offset-2">
                    Compléter
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </AdminPage>
  );
}
