import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { checkAccess } from "@/lib/server/authz";
import { syncAlerts } from "@/lib/server/channels/conflicts";

/**
 * Red banner on every back-office page for the associés (Lot 7) while a double booking is open, a platform's
 * calendar can't be read (failing, or not read for over an hour) or a booking e-mail waits to be handled (lot 7b: its
 * dates may not be blocked). Agents don't see it (Synchronisation is ADMIN only).
 * Reads the session, so it sits behind <Suspense> in the layout.
 */
export async function SyncBanner() {
  const access = await checkAccess(["ADMIN"]);
  if (!access.ok) return null;
  const a = await syncAlerts(access.organizationId);
  const broken = a.failing + a.stale;
  if (!a.openConflicts && !broken && !a.emailsPending) return null;
  return (
    <section aria-label="Alertes de synchronisation" className="border-b-2 border-error bg-[#fdecea] px-4 py-3 text-error md:px-8" data-testid="sync-banner">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-4 gap-y-1">
        <AlertTriangle className="size-5 shrink-0" aria-hidden="true" />
        {a.openConflicts > 0 && (
          <Link href="/admin/synchronisation/conflits" className="font-semibold underline underline-offset-2">
            {a.openConflicts === 1 ? "1 double réservation à résoudre" : `${a.openConflicts} doubles réservations à résoudre`}
          </Link>
        )}
        {a.emailsPending > 0 && (
          <Link href="/admin/synchronisation/emails" className="font-semibold underline underline-offset-2">
            {a.emailsPending === 1 ? "1 e-mail de réservation à traiter" : `${a.emailsPending} e-mails de réservation à traiter`}
          </Link>
        )}
        {broken > 0 && (
          <Link href="/admin/synchronisation" className="font-semibold underline underline-offset-2">
            {broken === 1 ? "1 calendrier de plateforme ne se synchronise plus" : `${broken} calendriers de plateformes ne se synchronisent plus`}
          </Link>
        )}
      </div>
    </section>
  );
}
