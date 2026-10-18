import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { ConflictActions } from "@/components/admin/channels/ChannelForms";
import { SOURCE_LABEL } from "@/lib/admin/booking-sources";
import { RESOLUTION_LABEL } from "@/lib/admin/channels";
import { formatDate, formatDateTime } from "@/lib/format";
import { requireAdminPage } from "@/lib/server/authz";
import { listConflicts } from "@/lib/server/channels/conflicts";

export const metadata: Metadata = { title: "Conflits de réservation" };

/** Synchronisation → Conflits (ADMIN, Lot 7): double bookings found by the imports, and how to resolve them. */
export default function Page() {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content />
    </Suspense>
  );
}

const day = (s: string) => formatDate(new Date(`${s}T00:00:00Z`));

async function Content() {
  const { organizationId } = await requireAdminPage("/admin/synchronisation");
  const [open, resolved] = await Promise.all([listConflicts(organizationId, { status: "OPEN" }), listConflicts(organizationId, { status: "RESOLVED", take: 30 })]);
  return (
    <AdminPage
      title="Conflits de réservation"
      intro={
        <>
          <Link href="/admin/synchronisation" className="underline underline-offset-2">
            Synchronisation
          </Link>{" "}
          · deux réservations sur les mêmes nuits. La réservation importée attend ici ; ses nuits sont déjà bloquées sur les autres plateformes.
        </>
      }
    >
      <div className="space-y-6">
        {open.length === 0 ? (
          <p className="rounded-lg border border-line bg-white p-4 text-ink-muted" data-testid="no-conflicts">
            Aucun conflit ouvert.
          </p>
        ) : (
          <ul className="space-y-3" data-testid="open-conflicts">
            {open.map((c) => (
              <li key={c.id} className="rounded-lg border-2 border-error bg-white p-4 md:p-5" data-testid="conflict">
                <p className="font-semibold">
                  <Link href={`/admin/biens/${c.listingId}/plateformes`} className="hover:underline">
                    {c.listingTitle}
                  </Link>
                </p>
                <p className="mt-1">
                  Import {SOURCE_LABEL[c.source]}
                  {c.block ? " (dates bloquées)" : ""} du <strong>{day(c.checkIn)}</strong> au <strong>{day(c.checkOut)}</strong> · réf. {c.externalRef}
                </p>
                <p className="mt-1">
                  En conflit avec{" "}
                  {c.blockingBookingId ? (
                    <Link href={`/admin/reservations/${c.blockingBookingId}`} className="font-semibold underline underline-offset-2">
                      {SOURCE_LABEL[c.blockingSource]}
                      {c.blockingRef ? ` (${c.blockingRef})` : ""}
                    </Link>
                  ) : (
                    SOURCE_LABEL[c.blockingSource]
                  )}{" "}
                  du {day(c.blockingCheckIn)} au {day(c.blockingCheckOut)}
                </p>
                <p className="mt-1 text-caption text-ink-muted">
                  Détecté le {formatDateTime(c.detectedAt)} · vu pour la dernière fois le {formatDateTime(c.lastSeenAt)}
                  {c.blockingSource !== "DIRECT" && c.blockingSource !== "OWNER" && ` · si vous annulez la réservation ${SOURCE_LABEL[c.blockingSource]}, annulez-la aussi sur la plateforme`}
                </p>
                <div className="mt-3">
                  <ConflictActions conflictId={c.id} canReplace />
                </div>
              </li>
            ))}
          </ul>
        )}
        <section aria-labelledby="resolved-title">
          <h2 id="resolved-title" className="mb-3 text-title-s font-semibold">
            Conflits résolus récemment
          </h2>
          {resolved.length === 0 ? (
            <p className="text-ink-muted">Aucun.</p>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line bg-white">
              {resolved.map((c) => (
                <li key={c.id} className="px-4 py-3">
                  <p className="font-medium">
                    {c.listingTitle} · {SOURCE_LABEL[c.source]} du {day(c.checkIn)} au {day(c.checkOut)}
                  </p>
                  <p className="text-caption text-ink-muted">
                    {c.resolution ? RESOLUTION_LABEL[c.resolution] : ""} · {c.resolvedAt ? formatDateTime(c.resolvedAt) : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AdminPage>
  );
}
