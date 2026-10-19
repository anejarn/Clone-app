import { FileText } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { card, OwnerFallback, OwnerFrame } from "@/components/owner/OwnerFrame";
import { ownerAmount, ownerDate, ownerInstantDate } from "@/lib/i18n/bidi";
import { fill } from "@/lib/i18n/owner";
import { listOwnerDocuments } from "@/lib/server/owner/documents";
import { ownerContext } from "@/lib/server/owner/context";
import { ownerReceipts } from "@/lib/server/owner/portal";

export const metadata: Metadata = { title: "Documents" };

/** Documents shared by Sigma (mandate, contracts, 80-14 authorisation…) and the receipts of the homes' expenses. */
export default function Page() {
  return (
    <Suspense fallback={<OwnerFallback />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const { viewer, locale, t } = await ownerContext("/proprietaire/documents");
  const [docs, receipts] = await Promise.all([listOwnerDocuments(viewer.organizationId, viewer.userId), ownerReceipts(viewer)]);
  return (
    <OwnerFrame locale={locale} t={t} active="documents" here="/proprietaire/documents" title={t.documents.title} intro={t.documents.intro}>
      <section aria-labelledby="shared">
        <h2 id="shared" className="mb-3 text-title-s font-semibold">
          {t.documents.shared}
        </h2>
        {docs.length === 0 ? (
          <p className={card}>{t.documents.none}</p>
        ) : (
          <ul className="divide-y divide-line-soft rounded-lg border border-line bg-white" data-testid="owner-documents">
            {docs.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 p-3 md:p-4">
                <span className="flex min-w-0 items-start gap-2">
                  <FileText className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block font-semibold">{d.title}</span>
                    <span className="block text-caption text-ink-muted">
                      {t.documents.kinds[d.kind]}
                      {d.listingTitle && ` · ${d.listingTitle}`} · {fill(t.documents.added, { date: ownerInstantDate(d.createdAt, locale) })}
                    </span>
                  </span>
                </span>
                <a href={`/api/owner-documents/${d.id}`} className="inline-flex h-10 items-center rounded-sm border border-ink px-3 font-semibold hover:bg-surface-2">
                  {t.common.open}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="mt-8" aria-labelledby="receipts">
        <h2 id="receipts" className="mb-3 text-title-s font-semibold">
          {t.documents.receipts}
        </h2>
        {receipts.length === 0 ? (
          <p className={card}>{t.documents.noReceipts}</p>
        ) : (
          <ul className="divide-y divide-line-soft rounded-lg border border-line bg-white" data-testid="owner-receipts">
            {receipts.map((r) => (
              <li key={r.expenseId} className="flex flex-wrap items-center justify-between gap-2 p-3 md:p-4">
                <span className="min-w-0">
                  <span className="block font-semibold">{r.description}</span>
                  <span className="block text-caption text-ink-muted">
                    {ownerDate(r.date, locale)} · {r.listingTitle} · {r.reference} · {ownerAmount(r.amountCents, locale)}
                  </span>
                </span>
                <a href={`/api/finances/expenses/${r.expenseId}/receipt`} className="inline-flex h-10 items-center rounded-sm border border-ink px-3 font-semibold hover:bg-surface-2">
                  {t.common.open}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </OwnerFrame>
  );
}
