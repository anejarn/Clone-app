import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { card, OwnerFallback, OwnerFrame } from "@/components/owner/OwnerFrame";
import { sourceLabel } from "@/components/owner/labels";
import { ltr, ownerAmount, ownerDate, ownerMonth } from "@/lib/i18n/bidi";
import { fill } from "@/lib/i18n/owner";
import { ownerContext } from "@/lib/server/owner/context";
import { ownerDashboard } from "@/lib/server/owner/portal";

export const metadata: Metadata = { title: "Accueil" };

/** The owner's home page: occupancy this month and next, revenue this year, balance, next arrivals. */
export default function Page() {
  return (
    <Suspense fallback={<OwnerFallback />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const { viewer, locale, t, access, organizationName } = await ownerContext("/proprietaire");
  const d = await ownerDashboard(viewer);
  const first = access.user.name.split(" ")[0];
  return (
    <OwnerFrame locale={locale} t={t} active="dashboard" here="/proprietaire" title={fill(t.dashboard.hello, { name: first })} intro={fill(t.dashboard.intro, { org: organizationName })}>
      {d.listings === 0 && <p className={`${card} mb-6`}>{t.dashboard.noListings}</p>}
      <div className="grid gap-4 md:grid-cols-2" data-testid="owner-kpis">
        <section className={card} aria-labelledby="ytd">
          <h2 id="ytd" className="text-caption text-ink-muted">
            {fill(t.dashboard.yearToDate, { year: d.year })}
          </h2>
          <p className="mt-1 text-title-l font-semibold" data-testid="owner-ytd">
            {ownerAmount(d.yearToDateCents, locale)}
          </p>
          <p className="mt-1 text-caption text-ink-muted">{t.dashboard.yearToDateHint}</p>
        </section>
        <section className={card} aria-labelledby="balance">
          <h2 id="balance" className="text-caption text-ink-muted">
            {t.dashboard.balance}
          </h2>
          <p className="mt-1 text-title-l font-semibold" data-testid="owner-balance">
            {ownerAmount(d.balanceCents, locale)}
          </p>
          <p className="mt-1 text-caption text-ink-muted">{t.dashboard.balanceHint}</p>
        </section>
      </div>

      <section className="mt-6" aria-labelledby="occupancy">
        <h2 id="occupancy" className="mb-3 text-title-s font-semibold">
          {t.dashboard.occupancy}
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          {d.months.map((m, i) => (
            <div key={m.month} className={card} data-testid="owner-occupancy">
              <p className="font-semibold">{fill(i === 0 ? t.dashboard.thisMonth : t.dashboard.nextMonth, { month: ownerMonth(m.month, locale) })}</p>
              <p className="mt-1 text-display font-semibold">{ltr(`${m.occupancyPct} %`, locale)}</p>
              <p className="text-caption text-ink-muted">{fill(t.dashboard.booked, { booked: m.bookedNights, total: m.availableNights })}</p>
              {m.listings.length > 1 && (
                <ul className="mt-3 space-y-1 text-caption">
                  {m.listings.map((l) => (
                    <li key={l.listingId} className="flex justify-between gap-3">
                      <span className="truncate">{l.title}</span>
                      <span className="shrink-0 font-medium">{ltr(`${l.occupancyPct} %`, locale)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {m.listings.some((l) => l.ownerNights) && <p className="mt-2 text-caption text-ink-muted">{fill(t.dashboard.ownerNights, { nights: m.listings.reduce((s, l) => s + l.ownerNights, 0) })}</p>}
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6" aria-labelledby="arrivals">
        <h2 id="arrivals" className="mb-3 text-title-s font-semibold">
          {t.dashboard.nextArrivals}
        </h2>
        {d.nextArrivals.length === 0 ? (
          <p className={card}>{t.dashboard.noArrivals}</p>
        ) : (
          <ul className="divide-y divide-line-soft rounded-lg border border-line bg-white" data-testid="owner-arrivals">
            {d.nextArrivals.map((b) => (
              <li key={`${b.listingId}-${b.checkIn}`} className="flex flex-wrap items-center justify-between gap-2 p-3 md:p-4">
                <span>
                  <Link href={`/proprietaire/biens/${b.listingId}`} className="font-semibold hover:underline">
                    {b.listingTitle}
                  </Link>
                  <span className="block text-caption text-ink-muted">
                    {ownerDate(b.checkIn, locale)} – {ownerDate(b.checkOut, locale)} · {fill(t.dashboard.nights, { n: b.nights })}
                  </span>
                </span>
                <span className="text-caption">
                  {sourceLabel(b.source, t)} · {fill(t.dashboard.guests, { n: b.guests })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </OwnerFrame>
  );
}
