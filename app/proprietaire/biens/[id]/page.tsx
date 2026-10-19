import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { card, OwnerFallback, OwnerFrame } from "@/components/owner/OwnerFrame";
import { sourceLabel } from "@/components/owner/labels";
import { ownerDate } from "@/lib/i18n/bidi";
import { ID_RE } from "@/lib/ids";
import { ownerContext } from "@/lib/server/owner/context";
import { ownerListing, ownerListingBookings } from "@/lib/server/owner/portal";

export const metadata: Metadata = { title: "Réservations" };

/** A home's bookings and blocks, read-only. Another owner's home — or any unknown id — is « introuvable ». */
export default function Page({ params }: PageProps<"/proprietaire/biens/[id]">) {
  return (
    <Suspense fallback={<OwnerFallback />}>
      <Content params={params} />
    </Suspense>
  );
}

const KIND_TONE = { STAY: "", OWNER_BLOCK: "bg-surface-2", PLATFORM_BLOCK: "bg-surface-2 text-ink-muted" } as const;

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const here = `/proprietaire/biens/${ID_RE.test(id) ? id : ""}`;
  const { viewer, locale, t } = await ownerContext(here);
  if (!ID_RE.test(id)) notFound();
  const [listing, bookings] = await Promise.all([ownerListing(viewer, id), ownerListingBookings(viewer, id)]);
  if (!listing || !bookings) notFound();
  return (
    <OwnerFrame locale={locale} t={t} active="listings" here={here} title={listing.title} intro={t.bookings.intro}>
      <Link href="/proprietaire/biens" className="mb-4 inline-block font-medium underline underline-offset-2">
        {t.common.back}
      </Link>
      <h2 className="mb-3 text-title-s font-semibold">{t.bookings.title}</h2>
      {bookings.length === 0 ? (
        <p className={card}>{t.bookings.none}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-white">
          <table className="w-full min-w-[560px] text-body" data-testid="owner-bookings">
            <thead>
              <tr className="border-b border-line text-start text-caption text-ink-muted">
                <th className="px-3 py-2 text-start font-medium">{t.bookings.dates}</th>
                <th className="px-3 py-2 text-end font-medium">{t.bookings.nights}</th>
                <th className="px-3 py-2 text-start font-medium">{t.bookings.kind}</th>
                <th className="px-3 py-2 text-start font-medium">{t.bookings.source}</th>
                <th className="px-3 py-2 text-end font-medium">{t.bookings.guests}</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <tr key={`${b.checkIn}-${b.kind}-${b.source}`} className={`border-t border-line-soft ${KIND_TONE[b.kind]}`} data-kind={b.kind}>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {ownerDate(b.checkIn, locale)} – {ownerDate(b.checkOut, locale)}
                  </td>
                  <td className="px-3 py-2 text-end">{b.nights}</td>
                  <td className="px-3 py-2">{t.kinds[b.kind]}</td>
                  <td className="px-3 py-2">{b.kind === "OWNER_BLOCK" ? t.sources.OWNER : sourceLabel(b.source, t)}</td>
                  <td className="px-3 py-2 text-end">{b.guests || "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-4 text-caption text-ink-muted">{t.bookings.blockSoon}</p>
    </OwnerFrame>
  );
}
