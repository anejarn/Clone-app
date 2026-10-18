import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { SyncJournal } from "@/components/admin/channels/SyncJournal";
import { SyncTabs } from "@/components/admin/channels/SyncTabs";
import { SOURCE_LABEL } from "@/lib/admin/booking-sources";
import { feedStatus } from "@/lib/admin/channels";
import { requireAdminPage } from "@/lib/server/authz";
import { feedStatuses, syncAlerts, syncJournal } from "@/lib/server/channels/conflicts";

export const metadata: Metadata = { title: "Synchronisation" };

/** Synchronisation (ADMIN, Lot 7): every feed's state, the open conflicts, the journal of the last reads. */
export default function Page() {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content />
    </Suspense>
  );
}

const TONE = { ok: "text-success", warn: "text-[#8a5a00]", error: "text-error", none: "text-ink-muted" } as const;

async function Content() {
  const { organizationId } = await requireAdminPage("/admin/synchronisation");
  const [alerts, feeds, runs] = await Promise.all([syncAlerts(organizationId), feedStatuses(organizationId), syncJournal(organizationId, { take: 100 })]);
  return (
    <AdminPage title="Synchronisation" intro="Calendriers échangés avec les plateformes par iCal : lecture toutes les 10 minutes, conflits, e-mails de réservation, prix à reporter, journal.">
      <SyncTabs current="apercu" alerts={alerts} />
      <div className="space-y-6">
        <ul className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <li className="rounded-lg border border-line bg-white p-5" data-testid="sync-conflicts-count">
            <p className="font-medium">Conflits ouverts</p>
            <p className={`mt-2 text-display font-semibold ${alerts.openConflicts ? "text-error" : ""}`}>{alerts.openConflicts}</p>
            <Link href="/admin/synchronisation/conflits" className="text-caption font-semibold underline underline-offset-2">
              Voir les conflits
            </Link>
          </li>
          <li className="rounded-lg border border-line bg-white p-5">
            <p className="font-medium">Calendriers en erreur</p>
            <p className={`mt-2 text-display font-semibold ${alerts.failing ? "text-error" : ""}`}>{alerts.failing}</p>
          </li>
          <li className="rounded-lg border border-line bg-white p-5">
            <p className="font-medium">Non lus depuis plus d&apos;une heure</p>
            <p className={`mt-2 text-display font-semibold ${alerts.stale ? "text-error" : ""}`}>{alerts.stale}</p>
          </li>
          <li className="rounded-lg border border-line bg-white p-5" data-testid="sync-emails-count">
            <p className="font-medium">E-mails à traiter</p>
            <p className={`mt-2 text-display font-semibold ${alerts.emailsPending ? "text-error" : ""}`}>{alerts.emailsPending}</p>
            <Link href="/admin/synchronisation/emails" className="text-caption font-semibold underline underline-offset-2">
              Voir les e-mails
            </Link>
          </li>
          <li className="rounded-lg border border-line bg-white p-5" data-testid="sync-prices-count">
            <p className="font-medium">Prix à reporter</p>
            <p className={`mt-2 text-display font-semibold ${alerts.priceReminders ? "text-[#8a5a00]" : ""}`}>{alerts.priceReminders}</p>
            <Link href="/admin/synchronisation/prix" className="text-caption font-semibold underline underline-offset-2">
              Voir les prix
            </Link>
          </li>
        </ul>

        <section aria-labelledby="feeds-title">
          <h2 id="feeds-title" className="mb-3 text-title-s font-semibold">
            Calendriers des biens
          </h2>
          {feeds.length === 0 ? (
            <p className="rounded-lg border border-line bg-white p-4 text-ink-muted">
              Aucun bien connecté. Ouvrez Biens → un bien → Plateformes pour créer les liens.
            </p>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line bg-white">
              {feeds.map((f) => {
                const s = feedStatus(f);
                return (
                  <li key={f.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <Link href={`/admin/biens/${f.listingId}/plateformes`} className="font-semibold hover:underline">
                        {f.listingTitle}
                      </Link>
                      <p className="text-caption text-ink-muted">
                        {SOURCE_LABEL[f.source]} · export {f.exportActive ? "actif" : "révoqué"} · import {f.importHost ?? "non configuré"}
                      </p>
                    </div>
                    <p className={`text-caption font-semibold ${TONE[s.tone]}`}>{s.text}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="journal-title">
          <h2 id="journal-title" className="mb-3 text-title-s font-semibold">
            Journal des synchronisations
          </h2>
          <SyncJournal runs={runs} showListing />
        </section>
      </div>
    </AdminPage>
  );
}
