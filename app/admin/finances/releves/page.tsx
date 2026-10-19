import { Download, Eye, FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { FinanceTabs, mad } from "@/components/admin/finances/FinanceViews";
import { GenerateStatementsButton, PayoutForm, RegenerateButton, ReversePayoutButton } from "@/components/admin/finances/StatementForms";
import { todayInTimeZone } from "@/lib/dates";
import { formatDate, formatDateTime } from "@/lib/format";
import { addMonths, FINANCE_TIMEZONE, isMonth, localMonth, monthLabel } from "@/lib/finance/months";
import { centimesToDirhams } from "@/lib/money";
import { requireAdminPage } from "@/lib/server/authz";
import { monthOverview } from "@/lib/server/finance/ledger";
import { monthStatements } from "@/lib/server/finance/statements";

export const metadata: Metadata = { title: "Relevés propriétaires" };

/**
 * Owners' monthly statements (Lot 6b, ADMIN): per owner, the overview's net due, the stored statement (every version),
 * the PDF, a provisional preview while the month is open, and the transfers made (« Virement effectué »).
 */
export default function Page({ searchParams }: PageProps<"/admin/finances/releves">) {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

const day = (iso: string) => formatDate(new Date(`${iso}T00:00:00Z`));

async function Content({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireAdminPage("/admin/finances");
  const sp = await searchParams;
  const current = localMonth(new Date());
  const month = isMonth(sp.mois) ? sp.mois : addMonths(current, -1);
  const [o, rows] = await Promise.all([monthOverview(access.organizationId, month), monthStatements(access.organizationId, month)]);
  const label = monthLabel(month);
  const netDue = new Map(o.owners.map((w) => [w.ownerId, w.totals.netDueOwnerCents + w.projectedRentCents]));
  const today = todayInTimeZone(FINANCE_TIMEZONE).toISOString().slice(0, 10);
  const nav = "inline-flex h-11 items-center rounded-sm border border-line bg-white px-4 font-medium hover:bg-surface-2";
  const hasStatements = rows.some((r) => r.latest);
  return (
    <AdminPage
      title={`Relevés · ${label}`}
      intro="Un relevé PDF par propriétaire et par mois clôturé, tiré du journal (mêmes chiffres que la vue mensuelle). Chaque nouvelle génération écrit une nouvelle version ; les précédentes restent archivées."
    >
      <FinanceTabs current="/admin/finances/releves" />
      <div className="space-y-6">
        <nav aria-label="Mois" className="flex flex-wrap items-center gap-3">
          <Link href={`/admin/finances/releves?mois=${addMonths(month, -1)}`} className={nav}>
            ← {monthLabel(addMonths(month, -1))}
          </Link>
          {month < current && (
            <Link href={`/admin/finances/releves?mois=${addMonths(month, 1)}`} className={nav}>
              {monthLabel(addMonths(month, 1))} →
            </Link>
          )}
          <span className={`rounded-full px-3 py-1 text-caption font-semibold ${o.closed ? "bg-ink text-white" : "bg-surface-2"}`} data-testid="statements-month-status">
            {o.closed ? "Clôturé" : "Ouvert"}
          </span>
        </nav>

        <section className="space-y-3 rounded-lg border border-line bg-white p-4 md:p-6">
          {o.closed ? (
            <div className="flex flex-wrap items-start gap-3">
              <GenerateStatementsButton month={month} label={label} />
              {hasStatements && (
                <a href={`/api/admin/finances/statements/mois?mois=${month}`} className={`${nav} gap-2`} data-testid="statements-all">
                  <Download className="size-4" aria-hidden="true" />
                  Tous les relevés (un PDF)
                </a>
              )}
            </div>
          ) : (
            <p className="text-ink-muted">
              Mois ouvert : les relevés définitifs seront générés à sa clôture (
              <Link href={`/admin/finances?mois=${month}`} className="font-semibold underline underline-offset-2">
                Vue mensuelle
              </Link>
              ). En attendant, l&apos;aperçu de chaque relevé porte la mention « Provisoire ».
            </p>
          )}
        </section>

        {rows.length === 0 ? (
          <p className="rounded-lg border border-line bg-white p-4 text-ink-muted">Aucun propriétaire n&apos;a d&apos;opération ce mois-ci.</p>
        ) : (
          <ul className="space-y-4" data-testid="statement-rows">
            {rows.map((r) => (
              <li key={r.ownerId} className="space-y-3 rounded-lg border border-line bg-white p-4 md:p-6" data-testid="statement-row" data-owner={r.ownerId}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-title-s font-semibold">{r.ownerName}</h2>
                    <p className="text-caption text-ink-muted">
                      Net dû du mois (vue mensuelle) : <span data-testid="overview-net-due">{mad(netDue.get(r.ownerId) ?? 0)}</span>
                    </p>
                  </div>
                  <a href={`/api/admin/finances/statements/apercu?mois=${month}&proprietaire=${r.ownerId}`} className={`${nav} gap-2`} data-testid="statement-preview">
                    <Eye className="size-4" aria-hidden="true" />
                    Aperçu{o.closed ? "" : " provisoire"}
                  </a>
                </div>
                {r.latest ? (
                  <div className="flex flex-wrap items-center gap-3" data-testid="statement-latest" data-version={r.latest.version}>
                    <a href={`/api/finances/statements/${r.latest.id}`} className="inline-flex h-11 items-center gap-2 rounded-sm bg-brand px-4 font-semibold text-white hover:bg-brand-strong" data-testid="statement-pdf">
                      <FileText className="size-4" aria-hidden="true" />
                      Relevé version {r.latest.version}
                    </a>
                    <span className="text-caption text-ink-muted">
                      généré le {formatDateTime(new Date(r.latest.generatedAt))} · net dû <span data-testid="statement-net-due">{mad(r.latest.netDueCents)}</span> · solde à verser{" "}
                      <span data-testid="statement-balance">{mad(r.latest.balanceCents)}</span>
                    </span>
                    {o.closed && <RegenerateButton ownerId={r.ownerId} month={month} ownerName={r.ownerName} />}
                  </div>
                ) : (
                  <p className="text-caption text-ink-muted">Pas encore de relevé {o.closed ? "(« Générer les relevés »)" : "(mois ouvert)"}.</p>
                )}
                {r.history.length > 1 && (
                  <details className="text-caption">
                    <summary className="cursor-pointer">Versions précédentes ({r.history.length - 1})</summary>
                    <ul className="mt-1 space-y-1">
                      {r.history.slice(1).map((h) => (
                        <li key={h.id}>
                          <a href={`/api/finances/statements/${h.id}`} className="underline underline-offset-2">
                            Version {h.version}
                          </a>{" "}
                          · {formatDateTime(new Date(h.generatedAt))} · net dû {mad(h.netDueCents)}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {r.payouts.length > 0 && (
                  <ul className="space-y-1 text-caption" data-testid="payouts">
                    {r.payouts.map((p) => (
                      <li key={p.id} className={`flex flex-wrap items-center gap-2 ${p.reversed ? "text-ink-muted line-through" : ""}`} data-testid="payout">
                        Virement du {day(p.paidOn)} · réf. {p.reference} · {mad(p.amountCents)}
                        {p.reversed ? <span className="no-underline">(annulé : {p.reversed.reason})</span> : <ReversePayoutButton id={p.id} />}
                      </li>
                    ))}
                  </ul>
                )}
                {r.latest && (
                  <>
                    {r.leftToPayCents !== null && r.leftToPayCents > 0 && (
                      <p className="text-caption">
                        Reste à verser : <strong data-testid="left-to-pay">{mad(r.leftToPayCents)}</strong>
                      </p>
                    )}
                    <PayoutForm ownerId={r.ownerId} month={month} today={today} defaultAmount={r.leftToPayCents && r.leftToPayCents > 0 ? centimesToDirhams(r.leftToPayCents) : ""} />
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </AdminPage>
  );
}
