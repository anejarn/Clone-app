import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { card, OwnerFallback, OwnerFrame } from "@/components/owner/OwnerFrame";
import { ownerDate, ownerPercent } from "@/lib/i18n/bidi";
import { fill } from "@/lib/i18n/owner";
import { ownerContext } from "@/lib/server/owner/context";
import { ownerListings } from "@/lib/server/owner/portal";

export const metadata: Metadata = { title: "Mes biens" };

/** The owner's homes: management type, commission, loi 80-14 authorisation, link to the bookings. */
export default function Page() {
  return (
    <Suspense fallback={<OwnerFallback />}>
      <Content />
    </Suspense>
  );
}

const LICENSE_TONE = { MISSING: "bg-surface-2", EXPIRED: "bg-[#fdecea] text-error", EXPIRING: "bg-[#fff4e5]", VALID: "bg-[#e8f5ec]" } as const;

async function Content() {
  const { viewer, locale, t } = await ownerContext("/proprietaire/biens");
  const listings = await ownerListings(viewer);
  return (
    <OwnerFrame locale={locale} t={t} active="listings" here="/proprietaire/biens" title={t.listings.title}>
      {listings.length === 0 ? (
        <p className={card}>{t.dashboard.noListings}</p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2" data-testid="owner-listings">
          {listings.map((l) => (
            <li key={l.id} className={card} data-listing={l.id}>
              <h2 className="text-title-s font-semibold">{l.title}</h2>
              <p className="text-caption text-ink-muted">
                {l.address}, {l.city}
              </p>
              <p className="mt-2 text-body">
                {t.listings.management[l.managementType]}
                {l.managementType === "MANAGED" && ` · ${fill(t.listings.commission, { pct: ownerPercent(l.commissionBps, locale) })}`}
              </p>
              <p className="mt-2 flex flex-wrap items-center gap-2 text-caption">
                <span>{t.listings.license}</span>
                <span className={`rounded-full px-2.5 py-0.5 font-semibold ${LICENSE_TONE[l.license.status]}`}>{t.listings.licenseStatus[l.license.status]}</span>
                {l.license.expiresAt && <span className="text-ink-muted">{fill(t.listings.expires, { date: ownerDate(l.license.expiresAt, locale) })}</span>}
              </p>
              {l.status === "DRAFT" && <p className="mt-1 text-caption text-ink-muted">{t.listings.draft}</p>}
              <Link href={`/proprietaire/biens/${l.id}`} className="mt-4 inline-flex h-11 items-center rounded-sm border border-ink px-4 font-semibold hover:bg-surface-2">
                {t.listings.bookings}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </OwnerFrame>
  );
}
