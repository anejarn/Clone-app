import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { CalendarBoard } from "@/components/admin/bookings/CalendarBoard";
import { SourceLegend } from "@/components/admin/bookings/SourceBadge";
import { addDays, CALENDAR_SPANS, calendarNav, calendarWindow, DEFAULT_SPAN, isoDay } from "@/lib/admin/calendar";
import { canSeeBookingAmounts, canWriteBookings } from "@/lib/admin/sections";
import { formatDate, pluralize } from "@/lib/format";
import { calendarData, calendarPlaces, staffToday } from "@/lib/server/admin/bookings";
import { requireAdminPage } from "@/lib/server/authz";

export const metadata: Metadata = { title: "Calendrier" };

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default function Page({ searchParams }: PageProps<"/admin/calendrier">) {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: Promise<Search> }) {
  const { user, organizationId } = await requireAdminPage("/admin/calendrier");
  const sp = await searchParams;
  const today = staffToday();
  const win = calendarWindow(today, one(sp.du), one(sp.jours));
  const places = await calendarPlaces(organizationId);
  const place = places.some((p) => p.slug === one(sp.quartier)) ? one(sp.quartier) : "";
  const q = one(sp.q).trim().slice(0, 100);
  const { listings, entries } = await calendarData(organizationId, win.start, win.end, { place: place || undefined, q: q || undefined }, canSeeBookingAmounts(user.role));
  const nav = calendarNav(win, today);
  const keep = Object.fromEntries(Object.entries({ jours: win.span === DEFAULT_SPAN ? "" : String(win.span), quartier: place, q }).filter(([, v]) => v));
  const href = (start: Date) => `/admin/calendrier?${new URLSearchParams({ ...keep, du: isoDay(start) })}`;
  const field = "h-11 w-full rounded-sm border border-ink-faint bg-white px-3 outline-none focus:border-ink focus:ring-1 focus:ring-ink";
  const navLink = "inline-flex h-10 items-center gap-1 rounded-sm border border-line bg-white px-3 font-medium hover:bg-surface-2";
  const canWrite = canWriteBookings(user.role);

  return (
    <AdminPage
      title="Calendrier"
      intro={`Toutes les réservations (directes et plateformes) et les blocages des propriétaires, du ${formatDate(win.start)} au ${formatDate(addDays(win.end, -1))} (nuits). Les réservations annulées n'apparaissent pas.`}
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <nav aria-label="Période" className="flex flex-wrap items-center gap-2">
            <Link href={href(nav.prevMonth)} className={navLink} aria-label="Mois précédent">
              <ChevronsLeft className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Mois</span>
            </Link>
            <Link href={href(nav.prevWeek)} className={navLink} aria-label="Semaine précédente">
              <ChevronLeft className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Semaine</span>
            </Link>
            <Link href={href(nav.today)} className={navLink} aria-current={isoDay(win.start) === isoDay(today) ? "date" : undefined}>
              Aujourd&apos;hui
            </Link>
            <Link href={href(nav.nextWeek)} className={navLink} aria-label="Semaine suivante">
              <span className="hidden sm:inline">Semaine</span>
              <ChevronRight className="size-4" aria-hidden="true" />
            </Link>
            <Link href={href(nav.nextMonth)} className={navLink} aria-label="Mois suivant">
              <span className="hidden sm:inline">Mois</span>
              <ChevronsRight className="size-4" aria-hidden="true" />
            </Link>
          </nav>
          {canWrite && (
            <Link
              href={`/admin/reservations/nouvelle?du=${isoDay(win.start)}`}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-sm bg-brand px-5 font-semibold text-white hover:bg-brand-strong"
            >
              <Plus className="size-4" aria-hidden="true" />
              Nouvelle saisie
            </Link>
          )}
        </div>

        <form method="get" role="search" aria-label="Afficher une autre période ou d'autres biens" className="grid gap-3 rounded-lg border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_2fr_auto] lg:items-end">
          <label className="block">
            <span className="mb-1 block text-micro font-medium">À partir du</span>
            <input type="date" name="du" defaultValue={isoDay(win.start)} className={field} />
          </label>
          <label className="block">
            <span className="mb-1 block text-micro font-medium">Durée affichée</span>
            <select name="jours" defaultValue={String(win.span)} className={field}>
              {CALENDAR_SPANS.map((n) => (
                <option key={n} value={n}>
                  {n} jours
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-micro font-medium">Quartier</span>
            <select name="quartier" defaultValue={place} className={field}>
              <option value="">Tous</option>
              {places.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-micro font-medium">Bien</span>
            <input name="q" type="search" defaultValue={q} placeholder="Titre ou adresse" className={field} />
          </label>
          <button type="submit" className="h-11 rounded-sm bg-ink px-5 font-semibold text-white hover:bg-black">
            Afficher
          </button>
        </form>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <SourceLegend />
          <p className="text-caption text-ink-muted" data-testid="calendar-count">
            {pluralize(listings.length, "bien", "biens")} · {pluralize(entries.length, "réservation ou blocage", "réservations ou blocages")}
          </p>
        </div>

        <CalendarBoard listings={listings} entries={entries} start={isoDay(win.start)} span={win.span} today={isoDay(today)} canWrite={canWrite} />
      </div>
    </AdminPage>
  );
}
