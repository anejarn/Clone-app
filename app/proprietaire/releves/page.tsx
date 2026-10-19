import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { card, OwnerFallback, OwnerFrame } from "@/components/owner/OwnerFrame";
import { ownerAmount, ownerDate, ownerInstantDate, ownerMonth } from "@/lib/i18n/bidi";
import { fill } from "@/lib/i18n/owner";
import { ownerStatementList } from "@/lib/server/finance/statements";
import { ownerContext } from "@/lib/server/owner/context";

export const metadata: Metadata = { title: "Relevés" };

/** The owner's monthly statements (latest version of each month), their transfers, PDF downloads. */
export default function Page() {
  return (
    <Suspense fallback={<OwnerFallback />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const { viewer, locale, t } = await ownerContext("/proprietaire/releves");
  const rows = await ownerStatementList(viewer.organizationId, viewer.userId);
  return (
    <OwnerFrame
      locale={locale}
      t={t}
      active="statements"
      here="/proprietaire/releves"
      title={t.statements.title}
      intro={
        <>
          {t.statements.intro}
          {locale !== "fr" && ` ${t.statements.pdfLanguage}`}
        </>
      }
    >
      {rows.length === 0 ? (
        <p className={card}>{t.statements.none}</p>
      ) : (
        <ul className="space-y-3" data-testid="owner-statements">
          {rows.map((s) => {
            const paid = s.payouts.filter((p) => !p.reversed);
            return (
              <li key={s.id} className={card} data-statement={s.id} data-month={s.month}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-title-s font-semibold">
                      <Link href={`/proprietaire/releves/${s.id}`} className="hover:underline">
                        {ownerMonth(s.month, locale)}
                      </Link>
                    </h2>
                    <p className="text-caption text-ink-muted">
                      {fill(t.statements.version, { n: s.version })} · {fill(t.statements.generated, { date: ownerInstantDate(s.generatedAt, locale) })}
                    </p>
                  </div>
                  <a
                    href={`/api/finances/statements/${s.id}?telecharger=1`}
                    className="inline-flex h-11 items-center gap-2 rounded-sm border border-ink px-4 font-semibold hover:bg-surface-2"
                    data-testid="statement-download"
                  >
                    <Download className="size-4" aria-hidden="true" />
                    {t.common.download}
                  </a>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-body">
                  <div>
                    <dt className="text-caption text-ink-muted">{t.statements.netDue}</dt>
                    <dd className="font-semibold">{ownerAmount(s.netDueCents, locale)}</dd>
                  </div>
                  <div>
                    <dt className="text-caption text-ink-muted">{t.statements.balance}</dt>
                    <dd className="font-semibold">{ownerAmount(s.balanceCents, locale)}</dd>
                  </div>
                </dl>
                <ul className="mt-3 space-y-1 text-caption" data-testid="statement-payouts">
                  {s.payouts.map((p) => (
                    <li key={p.id} className={p.reversed ? "text-ink-muted line-through" : "text-success"}>
                      {fill(t.statements.paid, { date: ownerDate(p.paidOn, locale), ref: p.reference, amount: ownerAmount(p.amountCents, locale) })}
                      {p.reversed && ` · ${t.statements.reversed}`}
                    </li>
                  ))}
                  {paid.length === 0 && s.balanceCents > 0 && <li className="text-ink-muted">{t.statements.pending}</li>}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </OwnerFrame>
  );
}
