import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { card, OwnerFallback, OwnerFrame } from "@/components/owner/OwnerFrame";
import { sourceLabel } from "@/components/owner/labels";
import { ownerAmount, ownerDate, ownerInstantDate, ownerMonth } from "@/lib/i18n/bidi";
import { fill, type OwnerLocale } from "@/lib/i18n/owner";
import { ID_RE } from "@/lib/ids";
import { statementDetail } from "@/lib/server/finance/statements";
import { ownerContext } from "@/lib/server/owner/context";

export const metadata: Metadata = { title: "Relevé" };

/**
 * One statement, as stored when it was generated (its figures: the PDF's), in the owner's language; the PDF itself is
 * French. Another owner's statement — or any unknown id — is « introuvable ».
 */
export default function Page({ params }: PageProps<"/proprietaire/releves/[id]">) {
  return (
    <Suspense fallback={<OwnerFallback />}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const here = `/proprietaire/releves/${ID_RE.test(id) ? id : ""}`;
  const { access, locale, t } = await ownerContext(here);
  if (!ID_RE.test(id)) notFound();
  const s = await statementDetail({ userId: access.user.id, role: "OWNER", organizationId: access.organizationId }, id);
  if (!s) notFound();
  const d = s.data;
  const a = (c: number) => ownerAmount(c, locale);
  const adj = (m: string | null) => (m ? ` (${fill(t.statement.adjustmentOf, { month: ownerMonth(m, locale) })})` : "");
  const th = "px-3 py-2 font-medium";
  return (
    <OwnerFrame locale={locale} t={t} active="statements" here={here} title={`${t.statements.title} · ${ownerMonth(d.month, locale)}`}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link href="/proprietaire/releves" className="font-medium underline underline-offset-2">
          {t.common.back}
        </Link>
        <a href={`/api/finances/statements/${s.id}`} className="inline-flex h-11 items-center gap-2 rounded-sm bg-brand px-4 font-semibold text-white hover:bg-brand-strong" data-testid="statement-pdf">
          <Download className="size-4" aria-hidden="true" />
          {t.statement.pdf}
        </a>
        <span className="text-caption text-ink-muted">
          {fill(t.statements.version, { n: s.version })} · {fill(t.statements.generated, { date: ownerInstantDate(s.generatedAt, locale) })}
          {locale !== "fr" && ` · ${t.statements.pdfLanguage}`}
        </span>
      </div>

      <div className="space-y-6" data-testid="statement-detail">
        {d.listings.map((l) => (
          <section key={l.listingId} className={card} aria-labelledby={`l-${l.listingId}`}>
            <h2 id={`l-${l.listingId}`} className="text-title-s font-semibold">
              {l.title}
            </h2>
            {l.managementType === "SUBLEASE" && l.stays.length === 0 && <p className="mt-1 text-caption text-ink-muted">{t.statement.sublease}</p>}
            {l.stays.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[720px] text-caption">
                  <thead>
                    <tr className="border-b border-line text-ink-muted">
                      <th className={`${th} text-start`}>{t.statement.stay}</th>
                      <th className={`${th} text-end`}>{t.statement.nights}</th>
                      <th className={`${th} text-start`}>{t.statement.source}</th>
                      <th className={`${th} text-end`}>{t.statement.gross}</th>
                      <th className={`${th} text-end`}>{t.statement.fees}</th>
                      <th className={`${th} text-end`}>{t.statement.cleaning}</th>
                      <th className={`${th} text-end`}>{t.statement.commission}</th>
                      <th className={`${th} text-end`}>{t.statement.ownerShare}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {l.stays.map((st) => (
                      <tr key={`${st.bookingId}-${st.adjustmentOf ?? ""}`} className="border-t border-line-soft">
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          {ownerDate(st.checkIn, locale)} – {ownerDate(st.checkOut, locale)}
                          {adj(st.adjustmentOf)}
                        </td>
                        <td className="px-3 py-1.5 text-end">{st.adjustmentOf ? "–" : st.nightsInMonth === st.nights ? st.nights : `${st.nightsInMonth}/${st.nights}`}</td>
                        <td className="px-3 py-1.5">{sourceLabel(st.source, t)}</td>
                        {[st.grossCents, st.platformFeeCents, st.cleaningCents, st.commissionCents, st.ownerShareCents].map((v, i) => (
                          <td key={i} className="px-3 py-1.5 text-end whitespace-nowrap">
                            {a(v)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {l.expenses.length > 0 && (
              <>
                <h3 className="mt-4 font-semibold">{t.statement.expenses}</h3>
                <ul className="mt-1 divide-y divide-line-soft text-caption">
                  {l.expenses.map((e) => (
                    <li key={`${e.expenseId}-${e.reversal}-${e.effect}-${e.adjustmentOf ?? ""}`} className="flex flex-wrap justify-between gap-2 py-1.5">
                      <span>
                        {ownerDate(e.date, locale)} · {e.reversal ? `${t.statement.reversal} : ` : ""}
                        {e.description} · {t.statement.effects[e.effect]} · {e.receiptRef ? fill(t.statement.receipt, { ref: e.receiptRef }) : t.statement.noReceipt}
                        {adj(e.adjustmentOf)}
                      </span>
                      <span className="whitespace-nowrap font-medium">{a(e.netEffectCents)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {[
              [t.statement.rents, l.rents],
              [t.statement.adjustments, l.adjustments],
            ].map(([title, lines]) =>
              (lines as typeof l.rents).length ? (
                <div key={title as string}>
                  <h3 className="mt-4 font-semibold">{title as string}</h3>
                  <ul className="mt-1 divide-y divide-line-soft text-caption">
                    {(lines as typeof l.rents).map((r, i) => (
                      <li key={i} className="flex flex-wrap justify-between gap-2 py-1.5">
                        <span>
                          {r.description}
                          {adj(r.adjustmentOf)}
                        </span>
                        <span className="whitespace-nowrap font-medium">{a(r.amountCents)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null,
            )}
            <p className="mt-4 flex justify-between gap-2 border-t border-line pt-2 font-semibold">
              <span>{t.statement.listingNet}</span>
              <span>{a(l.totals.netDueCents)}</span>
            </p>
          </section>
        ))}

        <Summary locale={locale} d={d} t={t} />
      </div>

      {s.versions.length > 1 && (
        <section className="mt-6" aria-labelledby="older">
          <h2 id="older" className="mb-2 font-semibold">
            {t.statement.older}
          </h2>
          <ul className="space-y-1 text-caption">
            {s.versions
              .filter((v) => v.id !== s.id)
              .map((v) => (
                <li key={v.id}>
                  <Link href={`/proprietaire/releves/${v.id}`} className="underline underline-offset-2">
                    {fill(t.statements.version, { n: v.version })}
                  </Link>{" "}
                  · {fill(t.statements.generated, { date: ownerInstantDate(v.generatedAt, locale) })}
                </li>
              ))}
          </ul>
        </section>
      )}
    </OwnerFrame>
  );
}

function Summary({ locale, d, t }: { locale: OwnerLocale; d: NonNullable<Awaited<ReturnType<typeof statementDetail>>>["data"]; t: Awaited<ReturnType<typeof ownerContext>>["t"] }) {
  const sm = d.summary;
  const rows: [string, number, boolean][] = [
    [t.statement.sumRevenue, sm.ownerRevenueCents, false],
    [t.statement.sumExpenses, sm.expensesNetCents, false],
    [t.statement.sumRent, sm.rentCents, false],
    [t.statement.sumAdjustments, sm.adjustmentsCents, false],
    [t.statement.sumNet, sm.netDueCents, true],
    [t.statement.sumPrevious, sm.previousBalanceCents, false],
    [t.statement.sumPayouts, -sm.payoutsCents, false],
    [t.statement.sumBalance, sm.balanceCents, true],
  ];
  return (
    <section className={card} aria-labelledby="summary">
      <h2 id="summary" className="text-title-s font-semibold">
        {t.statement.summary}
      </h2>
      <dl className="mt-3 space-y-1.5" data-testid="statement-summary">
        {rows.map(([label, v, strong]) => (
          <div key={label} className={`flex justify-between gap-3 ${strong ? "border-t border-line pt-1.5 font-semibold" : ""}`}>
            <dt>{label}</dt>
            <dd className="whitespace-nowrap" data-testid={strong && label === t.statement.sumBalance ? "statement-balance" : undefined}>
              {ownerAmount(v, locale)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-caption text-ink-muted">{t.statement.payment}</p>
    </section>
  );
}
