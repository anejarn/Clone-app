import { ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { DeclareButton } from "@/components/admin/declarations/StayActions";
import { TaxSummary } from "@/components/admin/declarations/TaxSummary";
import { TravelerCapture } from "@/components/admin/declarations/TravelerCapture";
import { countries } from "@/lib/declarations/countries";
import { FORMAT_WARNING } from "@/lib/declarations/exporters";
import { formatDateTime } from "@/lib/format";
import { requireAdminPage } from "@/lib/server/authz";
import { getBookingTax } from "@/lib/server/declarations/tax";
import { travelersForCapture, travelerSummary } from "@/lib/server/declarations/travelers";
import { AppError } from "@/lib/server/errors";
import { ID_RE } from "@/lib/server/schemas";

export const metadata: Metadata = { title: "Fiches voyageurs" };

const jjmmaaaa = (iso: string) => iso.split("-").reverse().join("/");

/** The travellers of one stay (associés): their fiches, document photos, declared or not, and the stay's tax. */
export default function Page({ params }: PageProps<"/admin/declarations/[id]">) {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const access = await requireAdminPage("/admin/declarations");
  const { id } = await params;
  if (!ID_RE.test(id)) notFound();
  const data = await travelersForCapture(access, { bookingId: id }).catch((e) => {
    if (e instanceof AppError && e.status === 404) return null;
    throw e;
  });
  if (!data) notFound();
  const { stay, travelers, purge } = data;
  const [summary, tax] = await Promise.all([travelerSummary(access.organizationId, stay.bookingId), getBookingTax(access.organizationId, stay.bookingId)]);
  const writable = stay.status === "CONFIRMED";

  return (
    <AdminPage
      title={`Fiches voyageurs · ${stay.guestName ?? "Voyageur sans nom"}`}
      intro={
        <>
          <Link href="/admin/declarations" className="underline underline-offset-2">
            Déclarations
          </Link>{" "}
          · {stay.listingTitle} · du {jjmmaaaa(stay.checkIn)} au {jjmmaaaa(stay.checkOut)} ·{" "}
          <Link href={`/admin/reservations/${stay.bookingId}`} className="underline underline-offset-2">
            Réservation
          </Link>
        </>
      }
    >
      <div className="space-y-5">
        <p className="flex items-start gap-2 rounded-lg border border-line bg-white p-4 text-caption text-ink-muted">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
          <span>
            Données personnelles chiffrées ; chaque consultation est enregistrée. Suppression automatique le {summary ? jjmmaaaa(summary.purgeOn) : "—"} (délai de conservation : Paramètres, à confirmer par Sigma / avocat — loi
            09-08, CNDP).
          </span>
        </p>
        {purge && (
          <p role="status" className="rounded-lg border border-line bg-surface-2 p-4" data-testid="identity-purged">
            Données d&apos;identité supprimées automatiquement le {formatDateTime(new Date(purge.purgedAt))} ({purge.travelerCount} voyageur{purge.travelerCount > 1 ? "s" : ""}).
          </p>
        )}
        {!writable && <p className="rounded-lg border border-line bg-white p-4 text-ink-muted">Ce séjour est annulé : les fiches ne se modifient plus.</p>}
        <TravelerCapture
          scope={{ bookingId: stay.bookingId }}
          stay={stay}
          travelers={travelers}
          countries={countries()}
          canViewDocuments
          writable={writable}
        />
        {travelers.length > 0 && (
          <section className="rounded-lg border border-line bg-white p-4 md:p-6" aria-labelledby="declared-title">
            <h2 id="declared-title" className="text-title-s font-semibold">
              Télé-déclaration
            </h2>
            <p className="mt-1 text-ink-muted">
              {summary?.declared ?? 0} voyageur(s) déclaré(s) sur {travelers.length}. {FORMAT_WARNING}
            </p>
            <div className="mt-3">
              <DeclareButton bookingId={stay.bookingId} declared={!!summary && summary.declared === travelers.length} />
            </div>
          </section>
        )}
        <section className="rounded-lg border border-line bg-white p-4 md:p-6" aria-labelledby="tax-title">
          <h2 id="tax-title" className="mb-3 text-title-s font-semibold">
            Taxe de séjour
          </h2>
          <TaxSummary bookingId={stay.bookingId} tax={tax} writable />
        </section>
      </div>
    </AdminPage>
  );
}
