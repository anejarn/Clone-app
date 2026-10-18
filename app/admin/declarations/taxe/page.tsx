import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { isoDay } from "@/lib/admin/calendar";
import { requireAdminPage } from "@/lib/server/authz";
import { monthlyTaxReport } from "@/lib/server/declarations/tax";
import { capturesToday } from "@/lib/server/declarations/travelers";
import { formatTaxAmount } from "@/lib/tax/form";

export const metadata: Metadata = { title: "Taxe de séjour" };

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthLabel = (m: string) => new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}-01T00:00:00Z`));
const shift = (m: string, n: number) => {
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1));
  return isoDay(d).slice(0, 7);
};

/** The month's taxe de séjour by home (ADMIN), from the stays' snapshots, with its CSV export. */
export default function Page({ searchParams }: PageProps<"/admin/declarations/taxe">) {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireAdminPage("/admin/declarations");
  const sp = await searchParams;
  const month = typeof sp.mois === "string" && MONTH_RE.test(sp.mois) ? sp.mois : isoDay(capturesToday()).slice(0, 7);
  const report = await monthlyTaxReport(access.organizationId, month);
  return (
    <AdminPage
      title={`Taxe de séjour · ${monthLabel(month)}`}
      intro={
        <>
          <Link href="/admin/declarations" className="underline underline-offset-2">
            Déclarations
          </Link>{" "}
          · par bien, nuits du mois de chaque séjour confirmé. Taux et exonérations à confirmer par Sigma auprès de la commune / du comptable (Paramètres).
        </>
      }
    >
      <div className="space-y-4">
        <nav aria-label="Mois" className="flex flex-wrap gap-3">
          <Link href={`/admin/declarations/taxe?mois=${shift(month, -1)}`} className="inline-flex h-11 items-center rounded-sm border border-line bg-white px-4 font-medium hover:bg-surface-2">
            ← {monthLabel(shift(month, -1))}
          </Link>
          <Link href={`/admin/declarations/taxe?mois=${shift(month, 1)}`} className="inline-flex h-11 items-center rounded-sm border border-line bg-white px-4 font-medium hover:bg-surface-2">
            {monthLabel(shift(month, 1))} →
          </Link>
          <a href={`/api/admin/declarations/taxe?mois=${month}`} className="inline-flex h-11 items-center gap-2 rounded-sm border border-ink bg-white px-4 font-semibold hover:bg-surface-2" data-testid="tax-report-csv">
            <Download className="size-4" aria-hidden="true" />
            Exporter en CSV
          </a>
        </nav>
        <div className="overflow-x-auto rounded-lg border border-line bg-white">
          <table className="w-full min-w-[640px] text-body" data-testid="tax-report">
            <thead>
              <tr className="border-b border-line text-left text-caption text-ink-muted">
                <th className="px-4 py-2 font-medium">Bien</th>
                <th className="px-4 py-2 font-medium">Séjours</th>
                <th className="px-4 py-2 font-medium">Nuits</th>
                <th className="px-4 py-2 font-medium">Nuitées taxables</th>
                <th className="px-4 py-2 text-right font-medium">Taxe</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-4 text-ink-muted">
                    Aucun séjour ce mois-ci.
                  </td>
                </tr>
              )}
              {report.rows.map((r) => (
                <tr key={r.listingId} className="border-t border-line-soft" data-testid="tax-report-row" data-listing={r.listingId}>
                  <td className="px-4 py-2">
                    {r.listingTitle}
                    {(r.estimated > 0 || r.missingRateNights > 0) && (
                      <span className="block text-caption text-ink-muted">
                        {r.estimated > 0 && `${r.estimated} séjour(s) estimé(s) d'après la réservation`}
                        {r.estimated > 0 && r.missingRateNights > 0 && " · "}
                        {r.missingRateNights > 0 && <span className="text-error">{r.missingRateNights} nuit(s) sans taux</span>}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">{r.stays}</td>
                  <td className="px-4 py-2">{r.nights}</td>
                  <td className="px-4 py-2">{r.taxableGuestNights}</td>
                  <td className="px-4 py-2 text-right font-medium">{formatTaxAmount(r.totalCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line font-semibold">
                <td className="px-4 py-2" colSpan={4}>
                  Total du mois
                </td>
                <td className="px-4 py-2 text-right" data-testid="tax-report-total">
                  {formatTaxAmount(report.totalCents)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </AdminPage>
  );
}
