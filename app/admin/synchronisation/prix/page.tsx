import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { PriceReminderDone } from "@/components/admin/channels/EmailForms";
import { SyncTabs } from "@/components/admin/channels/SyncTabs";
import { SOURCE_LABEL } from "@/lib/admin/booking-sources";
import { formatDateTime } from "@/lib/format";
import { requireAdminPage } from "@/lib/server/authz";
import { syncAlerts } from "@/lib/server/channels/conflicts";
import { listPriceReminders, type PriceReminderView } from "@/lib/server/channels/price-reminders";

export const metadata: Metadata = { title: "Prix à reporter" };

/**
 * Synchronisation → Prix à reporter (ADMIN, Lot 7b): iCal carries no prices, so every price change in Sigma (a season
 * or event, a home's base price, minimum stay or cleaning fee) is listed per connected platform until it is reported.
 */
export default function Page() {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const { organizationId } = await requireAdminPage("/admin/synchronisation");
  const [alerts, open, done] = await Promise.all([syncAlerts(organizationId), listPriceReminders(organizationId), listPriceReminders(organizationId, { done: true, take: 30 })]);
  const byListing = new Map<string, PriceReminderView[]>();
  for (const r of open) byListing.set(r.listingId, [...(byListing.get(r.listingId) ?? []), r]);
  return (
    <AdminPage title="Prix à reporter" intro="Les prix ne passent pas par iCal : chaque changement de prix fait dans Sigma est à reporter à la main sur chaque plateforme connectée du bien.">
      <SyncTabs current="prix" alerts={alerts} />
      <div className="space-y-6">
        {open.length === 0 ? (
          <p className="rounded-lg border border-line bg-white p-4 text-ink-muted" data-testid="no-price-reminders">
            Rien à reporter : les plateformes ont les prix de Sigma.
          </p>
        ) : (
          [...byListing.entries()].map(([listingId, items]) => (
            <section key={listingId} className="rounded-lg border-2 border-[#8a5a00] bg-white p-4 md:p-5" aria-labelledby={`pr-${listingId}`} data-testid="price-reminders-listing">
              <h2 id={`pr-${listingId}`} className="text-title-s font-semibold">
                <Link href={`/admin/biens/${listingId}/plateformes`} className="hover:underline">
                  {items[0].listingTitle}
                </Link>
              </h2>
              <ul className="mt-3 divide-y divide-line">
                {items.map((r) => (
                  <li key={r.id} className="flex flex-col gap-2 py-3 md:flex-row md:items-start md:justify-between" data-testid="price-reminder" data-source={r.source}>
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {SOURCE_LABEL[r.source]} · {r.subjectLabel}
                      </p>
                      <ul className="mt-1 space-y-0.5 text-caption">
                        {r.changes.map((c) => (
                          <li key={c.label}>
                            <span className="text-ink-muted">{c.label} : </span>
                            <span className="line-through decoration-ink-faint">{c.before ?? "—"}</span> → <strong>{c.after ?? "supprimé"}</strong>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-1 text-caption text-ink-muted">Modifié le {formatDateTime(r.updatedAt)}</p>
                    </div>
                    <PriceReminderDone reminderId={r.id} label={SOURCE_LABEL[r.source]} />
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
        <section aria-labelledby="done-title">
          <h2 id="done-title" className="mb-3 text-title-s font-semibold">
            Reportés récemment
          </h2>
          {done.length === 0 ? (
            <p className="text-ink-muted">Aucun.</p>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line bg-white">
              {done.map((r) => (
                <li key={r.id} className="px-4 py-3">
                  <p className="font-medium">
                    {r.listingTitle} · {SOURCE_LABEL[r.source]} · {r.subjectLabel}
                  </p>
                  <p className="text-caption text-ink-muted">Fait le {r.doneAt ? formatDateTime(r.doneAt) : ""}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AdminPage>
  );
}
