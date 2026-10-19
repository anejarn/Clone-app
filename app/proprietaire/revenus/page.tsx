import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { OwnerFallback, OwnerFrame } from "@/components/owner/OwnerFrame";
import { ownerAmount, ownerMonth } from "@/lib/i18n/bidi";
import { ownerContext } from "@/lib/server/owner/context";
import { ownerMonthlyFigures } from "@/lib/server/owner/portal";

export const metadata: Metadata = { title: "Revenus" };

/** The owner's figures month by month (last 12 months), from the journal. */
export default function Page() {
  return (
    <Suspense fallback={<OwnerFallback />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const { viewer, locale, t } = await ownerContext("/proprietaire/revenus");
  const months = await ownerMonthlyFigures(viewer);
  const head = [t.revenue.revenue, t.revenue.expenses, t.revenue.rent, t.revenue.adjustments, t.revenue.netDue, t.revenue.payouts];
  return (
    <OwnerFrame locale={locale} t={t} active="revenue" here="/proprietaire/revenus" title={t.revenue.title} intro={t.revenue.intro}>
      <div className="overflow-x-auto rounded-lg border border-line bg-white">
        <table className="w-full min-w-[820px] text-body" data-testid="owner-revenue">
          <thead>
            <tr className="border-b border-line text-caption text-ink-muted">
              <th className="px-3 py-2 text-start font-medium">{t.revenue.month}</th>
              {head.map((h) => (
                <th key={h} className="px-3 py-2 text-end font-medium">
                  {h}
                </th>
              ))}
              <th className="px-3 py-2 text-start font-medium">{t.revenue.statement}</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month} className="border-t border-line-soft" data-month={m.month}>
                <td className="px-3 py-2">
                  {ownerMonth(m.month, locale)}
                  <span className="block text-caption text-ink-muted">{m.closed ? t.common.closed : t.common.provisional}</span>
                </td>
                {[m.revenueCents, m.expensesNetCents, m.totals.subleaseRentCents, m.totals.ownerAdjustmentsCents, m.totals.netDueOwnerCents, m.totals.ownerPayoutsCents].map((v, i) => (
                  <td key={i} className={`px-3 py-2 text-end whitespace-nowrap ${i === 4 ? "font-semibold" : ""}`} data-testid={i === 4 ? "month-net-due" : undefined}>
                    {ownerAmount(v, locale)}
                  </td>
                ))}
                <td className="px-3 py-2">
                  {m.statementId ? (
                    <Link href={`/proprietaire/releves/${m.statementId}`} className="font-semibold underline underline-offset-2">
                      {t.common.open}
                    </Link>
                  ) : (
                    "–"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </OwnerFrame>
  );
}
