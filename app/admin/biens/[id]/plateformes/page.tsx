import { AlertTriangle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { SyncJournal } from "@/components/admin/channels/SyncJournal";
import { BookingRulesForm, FeedCard } from "@/components/admin/channels/ChannelForms";
import { ListingTabs } from "@/components/admin/guide/ListingTabs";
import { SOURCE_LABEL } from "@/lib/admin/booking-sources";
import { feedStatus } from "@/lib/admin/channels";
import { formatDate } from "@/lib/format";
import { requireAdminPage } from "@/lib/server/authz";
import { listConflicts, syncJournal } from "@/lib/server/channels/conflicts";
import { listingChannels } from "@/lib/server/channels/feeds";
import { publicOrigin } from "@/lib/server/guide/share";
import { ID_RE } from "@/lib/server/schemas";

export const metadata: Metadata = { title: "Plateformes du bien" };

/** Biens → a home → Plateformes (ADMIN): export links, platforms' iCal links, sync state, double-booking rules (Lot 7). */
export default function Page({ params }: PageProps<"/admin/biens/[id]/plateformes">) {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content params={params} />
    </Suspense>
  );
}

const day = (s: string) => formatDate(new Date(`${s}T00:00:00Z`));

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { organizationId } = await requireAdminPage("/admin/biens");
  const { id } = await params;
  const origin = await publicOrigin();
  // Another organization's listing is "not found", as an unknown one.
  const l = ID_RE.test(id) ? await listingChannels(organizationId, id, origin) : null;
  if (!l) notFound();
  const [conflicts, runs] = await Promise.all([listConflicts(organizationId, { listingId: l.id, status: "OPEN" }), syncJournal(organizationId, { listingId: l.id, take: 20 })]);
  return (
    <AdminPage
      title={l.title}
      intro={
        <>
          <Link href="/admin/biens" className="underline underline-offset-2">
            Biens
          </Link>{" "}
          · Plateformes · {l.placeName}
        </>
      }
    >
      <div className="space-y-5">
        <ListingTabs listingId={l.id} current="plateformes" />
        <p className="text-ink-muted">
          Sigma est le calendrier central du bien : chaque plateforme importe le lien d&apos;export Sigma (toutes les dates occupées, sauf ses propres réservations) et
          Sigma lit le calendrier de chaque plateforme toutes les 10 minutes. Les prix ne passent pas par iCal : reportez-les à la main sur chaque plateforme.
        </p>
        {conflicts.length > 0 && (
          <section className="rounded-lg border-2 border-error bg-white p-4 md:p-5" data-testid="listing-conflicts">
            <h2 className="flex items-center gap-2 font-semibold text-error">
              <AlertTriangle className="size-5" aria-hidden="true" />
              Double réservation à résoudre ({conflicts.length})
            </h2>
            <ul className="mt-2 list-disc pl-5">
              {conflicts.map((c) => (
                <li key={c.id}>
                  {SOURCE_LABEL[c.source]} du {day(c.checkIn)} au {day(c.checkOut)}, en conflit avec {SOURCE_LABEL[c.blockingSource]} du {day(c.blockingCheckIn)} au {day(c.blockingCheckOut)}
                </li>
              ))}
            </ul>
            <Link href="/admin/synchronisation/conflits" className="mt-2 inline-block font-semibold underline underline-offset-2">
              Résoudre les conflits
            </Link>
          </section>
        )}
        <BookingRulesForm listingId={l.id} preparationDays={l.preparationDays} minNoticeDays={l.minNoticeDays} />
        {l.feeds.map((f) => (
          <FeedCard
            key={f.source}
            listingId={l.id}
            source={f.source}
            label={f.label}
            exportUrl={f.exportUrl}
            exportRevoked={f.exportRevoked}
            importHost={f.importHost}
            importHint={f.importHint}
            exportHint={f.exportHint}
            status={feedStatus(f)}
          />
        ))}
        <section aria-labelledby="journal-title">
          <h2 id="journal-title" className="mb-3 text-title-s font-semibold">
            Journal des synchronisations
          </h2>
          <SyncJournal runs={runs} showListing={false} />
        </section>
      </div>
    </AdminPage>
  );
}
