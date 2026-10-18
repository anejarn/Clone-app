import { CalendarDays, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { bookingTitle } from "@/components/admin/bookings/BookingDetail";
import { SourceBadge } from "@/components/admin/bookings/SourceBadge";
import { SOURCE_LABEL } from "@/lib/admin/booking-sources";
import { isoDay, parseDay } from "@/lib/admin/calendar";
import { canSeeBookingAmounts, canWriteBookings } from "@/lib/admin/sections";
import { formatDate, formatPrice, pluralize } from "@/lib/format";
import type { BookingSource } from "@/lib/generated/prisma/enums";
import { entryListings, listStaffBookings, staffToday, type StaffBookingFilters } from "@/lib/server/admin/bookings";
import { requireAdminPage } from "@/lib/server/authz";

export const metadata: Metadata = { title: "Réservations" };

/** URL values of the filters (French, readable in the address bar) and what they mean. */
const SOURCE = {
  directe: "DIRECT",
  airbnb: "AIRBNB",
  booking: "BOOKING",
  agoda: "AGODA",
  tripcom: "TRIPCOM",
  expedia: "EXPEDIA",
  proprietaire: "OWNER",
} as const satisfies Record<string, BookingSource>;
const STATUS = { confirmees: "CONFIRMED", annulees: "CANCELLED", toutes: "ALL" } as const;

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
const pick = <T extends Record<string, string>>(map: T, v: string): T[keyof T] | undefined => (Object.hasOwn(map, v) ? map[v as keyof T] : undefined);
const day = (s: string) => formatDate(parseDay(s)!);

export default function Page({ searchParams }: PageProps<"/admin/reservations">) {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: Promise<Search> }) {
  const { user, organizationId } = await requireAdminPage("/admin/reservations");
  const sp = await searchParams;
  const today = staffToday();
  const listings = await entryListings(organizationId);
  // No "du" in the URL: from today (stays not over yet). An empty "du": no lower bound.
  const raw = {
    source: one(sp.source),
    bien: listings.some((l) => l.id === one(sp.bien)) ? one(sp.bien) : "",
    du: sp.du === undefined ? isoDay(today) : parseDay(one(sp.du)) ? one(sp.du) : "",
    au: parseDay(one(sp.au)) ? one(sp.au) : "",
    statut: one(sp.statut),
  };
  const filters: StaffBookingFilters = {
    source: pick(SOURCE, raw.source),
    listingId: raw.bien || undefined,
    from: parseDay(raw.du) ?? undefined,
    to: parseDay(raw.au) ?? undefined,
    status: pick(STATUS, raw.statut) ?? "CONFIRMED",
    page: Math.min(1000, Math.max(1, Number.parseInt(one(sp.page), 10) || 1)),
  };
  const showAmounts = canSeeBookingAmounts(user.role);
  const { items, total, page, pageCount } = await listStaffBookings(organizationId, filters, showAmounts);
  const pageHref = (p: number) => `/admin/reservations?${new URLSearchParams({ ...raw, page: String(p) })}`;
  const field = "h-11 w-full rounded-sm border border-ink-faint bg-white px-3 outline-none focus:border-ink focus:ring-1 focus:ring-ink";

  return (
    <AdminPage
      title="Réservations"
      intro="Toutes les réservations des biens (site, téléphone, WhatsApp, plateformes) et les blocages des propriétaires. Par défaut : les séjours pas encore terminés."
    >
      <div className="mb-4 flex flex-wrap justify-end gap-2">
        <Link href="/admin/calendrier" className="inline-flex h-11 items-center gap-2 rounded-sm border border-ink px-5 font-semibold hover:bg-surface-2">
          <CalendarDays className="size-4" aria-hidden="true" />
          Calendrier
        </Link>
        {canWriteBookings(user.role) && (
          <Link href="/admin/reservations/nouvelle" className="inline-flex h-11 items-center gap-2 rounded-sm bg-brand px-5 font-semibold text-white hover:bg-brand-strong">
            <Plus className="size-4" aria-hidden="true" />
            Nouvelle saisie
          </Link>
        )}
      </div>

      <form method="get" role="search" aria-label="Filtrer les réservations" className="grid gap-3 rounded-lg border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-[1fr_2fr_1fr_1fr_1fr_auto] lg:items-end">
        <label className="block">
          <span className="mb-1 block text-micro font-medium">Source</span>
          <select name="source" defaultValue={raw.source} className={field}>
            <option value="">Toutes</option>
            {Object.entries(SOURCE).map(([k, s]) => (
              <option key={k} value={k}>
                {SOURCE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-micro font-medium">Bien</span>
          <select name="bien" defaultValue={raw.bien} className={field}>
            <option value="">Tous</option>
            {listings.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title} — {l.address}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-micro font-medium">Du</span>
          <input type="date" name="du" defaultValue={raw.du} className={field} />
        </label>
        <label className="block">
          <span className="mb-1 block text-micro font-medium">Au</span>
          <input type="date" name="au" defaultValue={raw.au} className={field} />
        </label>
        <label className="block">
          <span className="mb-1 block text-micro font-medium">Statut</span>
          <select name="statut" defaultValue={raw.statut || "confirmees"} className={field}>
            <option value="confirmees">Confirmées</option>
            <option value="annulees">Annulées</option>
            <option value="toutes">Toutes</option>
          </select>
        </label>
        <button type="submit" className="h-11 rounded-sm bg-ink px-5 font-semibold text-white hover:bg-black">
          Filtrer
        </button>
      </form>

      <p className="mt-4 text-ink-muted" data-testid="booking-count">
        {pluralize(total, "réservation ou blocage", "réservations ou blocages")}
        {pageCount > 1 && ` · page ${page} sur ${pageCount}`}
      </p>

      {items.length === 0 ? (
        <p className="mt-3 rounded-lg border border-line bg-white p-5 text-ink-muted">Aucune réservation ne correspond à ces critères.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-white" data-testid="booking-rows">
          {items.map((b) => (
            <li key={b.id} className="p-3 md:px-4" data-source={b.source} data-status={b.status}>
              <div className="flex flex-col gap-1 md:flex-row md:items-start md:justify-between md:gap-4">
                <div className="min-w-0">
                  <Link href={`/admin/reservations/${b.id}`} className="font-semibold hover:underline">
                    {bookingTitle(b)}
                  </Link>
                  <p className="mt-0.5 truncate text-caption text-ink-muted">
                    {b.listingTitle} · {b.placeName}
                  </p>
                </div>
                <div className="shrink-0 md:text-right">
                  <p>
                    {day(b.checkIn)} → {day(b.checkOut)} <span className="text-ink-muted">· {pluralize(b.nights, "nuit", "nuits")}</span>
                  </p>
                  {b.amounts && b.source !== "OWNER" && <p className="text-caption font-medium">{formatPrice(b.amounts.totalCents)}</p>}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-caption">
                <SourceBadge source={b.source} />
                {b.externalRef && <span className="font-mono text-ink-muted">{b.externalRef}</span>}
                {b.guestPhone && <span className="text-ink-muted">{b.guestPhone}</span>}
                {b.status === "CANCELLED" && <span className="rounded-pill bg-[#fdecea] px-2.5 py-0.5 font-medium text-error">Annulée</span>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {pageCount > 1 && (
        <nav aria-label="Pages" className="mt-4 flex items-center justify-between gap-3">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="font-semibold underline underline-offset-2">
              Page précédente
            </Link>
          ) : (
            <span />
          )}
          {page < pageCount && (
            <Link href={pageHref(page + 1)} className="font-semibold underline underline-offset-2">
              Page suivante
            </Link>
          )}
        </nav>
      )}
    </AdminPage>
  );
}
