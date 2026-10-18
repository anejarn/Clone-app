import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { addDays, isoDay, monthLabel, parseDay, weekdayShort } from "@/lib/admin/calendar";
import { cn } from "@/lib/cn";
import { formatDate, formatPrice, pluralize } from "@/lib/format";
import { staffToday } from "@/lib/server/admin/bookings";
import { DEFAULT_PRICE_CALENDAR_DAYS, PRICE_CALENDAR_SPANS, priceCalendarFor, ruleListingOptions, type PriceCalendarDay } from "@/lib/server/admin/prices";
import { requireAdminPage } from "@/lib/server/authz";

export const metadata: Metadata = { title: "Calendrier des prix" };

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default function Page({ searchParams }: PageProps<"/admin/prix/apercu">) {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

/**
 * A home's next nights as the site and the back-office price them (lib/pricing/engine.ts): each night's price, the
 * rule that set it, the minimum stay of a stay including it, and whether it is taken.
 */
async function Content({ searchParams }: { searchParams: Promise<Search> }) {
  const { organizationId } = await requireAdminPage("/admin/prix");
  const sp = await searchParams;
  const listings = await ruleListingOptions(organizationId);
  const bien = listings.some((l) => l.id === one(sp.bien)) ? one(sp.bien) : (listings[0]?.id ?? "");
  const days = (PRICE_CALENDAR_SPANS as readonly number[]).includes(Number(one(sp.jours))) ? Number(one(sp.jours)) : DEFAULT_PRICE_CALENDAR_DAYS;
  const today = staffToday();
  const from = parseDay(one(sp.du)) ?? today;
  const cal = bien ? await priceCalendarFor(organizationId, bien, from, days) : null;
  const select = "h-11 w-full rounded-sm border border-ink-faint bg-white px-3 outline-none focus:border-ink focus:ring-1 focus:ring-ink";
  const rules = cal ? [...new Map(cal.days.flatMap((d) => (d.rule ? [[d.rule.id, d.rule] as const] : []))).values()] : [];

  return (
    <AdminPage
      title="Calendrier des prix"
      intro={
        <>
          <Link href="/admin/prix" className="underline underline-offset-2">
            Prix
          </Link>{" "}
          · Le prix de chaque nuit tel que le site et la saisie des réservations le calculent, saisons et événements compris.
        </>
      }
    >
      <form method="get" aria-label="Choisir le bien et la période" className="grid gap-3 rounded-lg border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-[3fr_1fr_1fr_auto] lg:items-end">
        <label className="block">
          <span className="mb-1 block text-micro font-medium">Bien</span>
          <select name="bien" defaultValue={bien} className={select}>
            {listings.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title} · {l.placeName}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-micro font-medium">À partir du</span>
          <input type="date" name="du" defaultValue={isoDay(from)} className={select} />
        </label>
        <label className="block">
          <span className="mb-1 block text-micro font-medium">Durée</span>
          <select name="jours" defaultValue={String(days)} className={select}>
            {PRICE_CALENDAR_SPANS.map((n) => (
              <option key={n} value={n}>
                {n} nuits
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="h-11 rounded-sm bg-ink px-5 font-semibold text-white hover:bg-black">
          Afficher
        </button>
      </form>

      {!cal ? (
        <p className="mt-4 rounded-lg border border-line bg-white p-5 text-ink-muted">Aucun bien : ajoutez d&apos;abord un bien dans Biens.</p>
      ) : (
        <>
          <div className="mt-4 flex flex-col gap-3 rounded-lg border border-line bg-white p-4 md:flex-row md:items-center md:justify-between" data-testid="price-summary">
            <p>
              <Link href={`/admin/biens/${cal.listing.id}`} className="font-semibold underline underline-offset-2">
                {cal.listing.title}
              </Link>
              <span className="block text-caption text-ink-muted">
                Prix de base {formatPrice(cal.listing.priceCents)} / nuit · ménage {formatPrice(cal.listing.cleaningFeeCents)} · séjour minimum {pluralize(cal.listing.minNights, "nuit", "nuits")} · du {formatDate(from)} au{" "}
                {formatDate(addDays(from, days - 1))}
              </span>
            </p>
            <Link href={`/admin/prix/nouvelle?bien=${cal.listing.id}`} className="inline-flex h-11 shrink-0 items-center justify-center rounded-sm border border-ink px-4 font-semibold hover:bg-surface-2">
              Nouvelle règle pour ce bien
            </Link>
          </div>
          {rules.length > 0 && (
            <p className="mt-3 text-ink-muted" data-testid="price-rules-used">
              Règles appliquées sur la période :{" "}
              {rules.map((r, i) => (
                <span key={r.id}>
                  {i > 0 && ", "}
                  <Link href={`/admin/prix/${r.id}`} className="font-medium text-ink underline underline-offset-2">
                    {r.name}
                  </Link>
                </span>
              ))}
              .
            </p>
          )}
          <PriceGrid days={cal.days} baseCents={cal.listing.priceCents} baseMin={cal.listing.minNights} />
        </>
      )}
    </AdminPage>
  );
}

function PriceGrid({ days, baseCents, baseMin }: { days: PriceCalendarDay[]; baseCents: number; baseMin: number }) {
  // One block per month; within it, one cell per night (7 a row on a computer, 2 on a phone).
  const months: { label: string; days: PriceCalendarDay[] }[] = [];
  for (const d of days) {
    const label = monthLabel(new Date(`${d.date}T00:00:00Z`));
    if (months.at(-1)?.label === label) months.at(-1)!.days.push(d);
    else months.push({ label, days: [d] });
  }
  return (
    <div className="mt-4 space-y-6" data-testid="price-calendar">
      {months.map((m) => (
        <section key={m.label}>
          <h2 className="mb-2 text-title-s font-semibold first-letter:uppercase">{m.label}</h2>
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {m.days.map((d) => {
              const date = new Date(`${d.date}T00:00:00Z`);
              const up = d.priceCents > baseCents;
              const down = d.priceCents < baseCents;
              return (
                <li
                  key={d.date}
                  data-testid="price-day"
                  data-date={d.date}
                  data-price={d.priceCents}
                  data-min-nights={d.minNights}
                  className={cn("min-w-0 rounded-sm border p-2", d.rule ? "border-brand bg-brand-tint" : "border-line bg-white", d.booked && "bg-surface-3")}
                >
                  <p className="text-caption text-ink-muted">
                    {weekdayShort(date)} {formatDate(date).slice(0, 5)}
                  </p>
                  <p className={cn("font-semibold", up && "text-brand-deep", down && "text-ink")}>{formatPrice(d.priceCents)}</p>
                  <p className={cn("text-caption", d.minNights > baseMin ? "font-medium text-ink" : "text-ink-muted")}>min. {pluralize(d.minNights, "nuit", "nuits")}</p>
                  {d.rule && <p className="truncate text-caption text-brand-deep" title={d.rule.name}>{d.rule.name}</p>}
                  {d.booked && <p className="text-caption font-medium">Réservé</p>}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
