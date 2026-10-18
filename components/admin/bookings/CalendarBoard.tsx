"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { SOURCE_LABEL, SOURCE_SHORT, sourceStyle } from "@/lib/admin/booking-sources";
import { addDays, barLayout, daysBetween, isWeekend, monthGroups, parseDay, weekdayShort, type BarLayout } from "@/lib/admin/calendar";
import { cn } from "@/lib/cn";
import { formatDate, pluralize } from "@/lib/format";
import type { CalendarListing, StaffBookingView } from "@/lib/server/admin/bookings";
import { BookingDetail, bookingTitle } from "./BookingDetail";
import { SourceSwatch } from "./SourceBadge";

/** Width of a night column and of the listing names, in px. */
const CELL = 40;
const LABEL_W = 232;

const fmt = (s: string) => formatDate(parseDay(s)!);

function barLabel(e: StaffBookingView) {
  return `${SOURCE_LABEL[e.source]} · ${bookingTitle(e)} · du ${fmt(e.checkIn)} au ${fmt(e.checkOut)} (${pluralize(e.nights, "nuit", "nuits")})`;
}

/**
 * The calendar of every home: a timeline from md up (one row per home, one column per night, bookings as bars in
 * their source's colour, owner blocks hatched), and on phones an agenda by home. Clicking a booking opens its
 * detail in a panel. The data comes from the server already stripped for the viewer's role (no amounts for agents).
 */
export function CalendarBoard({
  listings,
  entries,
  start,
  span,
  today,
  canWrite,
}: {
  listings: CalendarListing[];
  entries: StaffBookingView[];
  /** yyyy-MM-dd of the first night shown. */
  start: string;
  span: number;
  /** yyyy-MM-dd, in Marrakech. */
  today: string;
  canWrite: boolean;
}) {
  const [selected, setSelected] = useState<StaffBookingView | null>(null);
  const win = useMemo(() => {
    const s = parseDay(start)!;
    return { start: s, end: addDays(s, span), days: Array.from({ length: span }, (_, i) => addDays(s, i)) };
  }, [start, span]);
  const byListing = useMemo(() => {
    const m = new Map<string, { entry: StaffBookingView; bar: BarLayout }[]>();
    for (const e of entries) {
      const bar = barLayout(win, parseDay(e.checkIn)!, parseDay(e.checkOut)!);
      if (!bar) continue;
      const list = m.get(e.listingId) ?? [];
      list.push({ entry: e, bar });
      m.set(e.listingId, list);
    }
    return m;
  }, [entries, win]);
  const todayCol = daysBetween(win.start, parseDay(today)!);

  return (
    <>
      <Timeline listings={listings} byListing={byListing} days={win.days} todayCol={todayCol} onOpen={setSelected} />
      <Agenda listings={listings} byListing={byListing} onOpen={setSelected} />
      <Dialog.Root open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content
            aria-describedby={undefined}
            data-testid="booking-panel"
            className="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-lg bg-white p-5 shadow-modal outline-none md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[440px] md:rounded-none md:p-6"
          >
            {selected && (
              <>
                <div className="mb-4 flex items-start justify-between gap-3">
                  <Dialog.Title className="text-title-s font-semibold">{bookingTitle(selected)}</Dialog.Title>
                  <Dialog.Close className="grid size-9 shrink-0 place-items-center rounded-full border border-line bg-white hover:bg-surface-2" aria-label="Fermer">
                    <X className="size-4" aria-hidden="true" />
                  </Dialog.Close>
                </div>
                <BookingDetail booking={selected} />
                <div className="mt-6 flex flex-col gap-2 sm:flex-row">
                  <Link
                    href={`/admin/reservations/${selected.id}`}
                    className="inline-flex h-11 items-center justify-center rounded-sm bg-ink px-5 font-semibold text-white hover:bg-black"
                  >
                    {canWrite ? "Ouvrir pour modifier ou annuler" : "Ouvrir la fiche"}
                  </Link>
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

type Rows = Map<string, { entry: StaffBookingView; bar: BarLayout }[]>;

function Timeline({
  listings,
  byListing,
  days,
  todayCol,
  onOpen,
}: {
  listings: CalendarListing[];
  byListing: Rows;
  days: Date[];
  todayCol: number;
  onOpen: (e: StaffBookingView) => void;
}) {
  const width = LABEL_W + days.length * CELL;
  return (
    <div className="hidden overflow-hidden rounded-lg border border-line bg-white md:block" data-testid="calendar-grid">
      <div className="overflow-x-auto" role="region" aria-label="Calendrier de tous les biens, une ligne par bien" tabIndex={0}>
        <div style={{ width }} className="relative">
          {/* Month and day headers. */}
          <div className="sticky top-0 z-20 border-b border-line bg-white">
            <div className="flex">
              <div style={{ width: LABEL_W }} className="sticky left-0 z-10 shrink-0 bg-white" />
              {monthGroups(days).map((m, i) => (
                <div key={i} style={{ width: m.span * CELL }} className="truncate border-l border-line-soft px-2 pt-2 text-caption font-semibold capitalize">
                  {m.label}
                </div>
              ))}
            </div>
            <div className="flex">
              <div style={{ width: LABEL_W }} className="sticky left-0 z-10 flex shrink-0 items-end bg-white px-3 pb-1 text-micro font-medium text-ink-muted">
                Bien
              </div>
              {days.map((d, i) => (
                <div
                  key={i}
                  style={{ width: CELL }}
                  className={cn(
                    "flex shrink-0 flex-col items-center py-1 text-micro",
                    isWeekend(d) && "bg-surface-2",
                    i === todayCol && "bg-brand text-white",
                  )}
                  aria-current={i === todayCol ? "date" : undefined}
                  title={formatDate(d)}
                >
                  <span className={i === todayCol ? "" : "text-ink-muted"}>{weekdayShort(d).replace(".", "")}</span>
                  <span className="font-semibold">{d.getUTCDate()}</span>
                </div>
              ))}
            </div>
          </div>

          {listings.length === 0 ? (
            <p className="p-5 text-ink-muted">Aucun bien ne correspond à ces critères.</p>
          ) : (
            <ul className="relative">
              {/* Weekend and today columns, behind the rows. */}
              {days.map((d, i) =>
                isWeekend(d) || i === todayCol ? (
                  <li
                    key={`col-${i}`}
                    aria-hidden="true"
                    className={cn("pointer-events-none absolute inset-y-0", i === todayCol ? "border-x-2 border-brand/60" : "bg-surface-2")}
                    style={{ left: LABEL_W + i * CELL, width: CELL }}
                  />
                ) : null,
              )}
              {listings.map((l) => {
                const bars = byListing.get(l.id) ?? [];
                return (
                  <li key={l.id} className="relative flex border-b border-line-soft last:border-b-0" data-testid="calendar-row" data-listing={l.id}>
                    <div style={{ width: LABEL_W }} className="sticky left-0 z-10 shrink-0 border-r border-line bg-white px-3 py-1.5">
                      <p className="truncate text-caption font-semibold" title={l.title}>
                        {l.title}
                      </p>
                      <p className="truncate text-micro text-ink-muted">{l.placeName}</p>
                    </div>
                    <div
                      className="relative h-11 shrink-0"
                      style={{
                        width: days.length * CELL,
                        backgroundImage: "linear-gradient(to right, var(--color-line-soft) 1px, transparent 1px)",
                        backgroundSize: `${CELL}px 100%`,
                      }}
                    >
                      {bars.map(({ entry: e, bar }) => {
                        const s = sourceStyle(e.source);
                        return (
                          <button
                            key={e.id}
                            type="button"
                            onClick={() => onOpen(e)}
                            aria-label={barLabel(e)}
                            title={barLabel(e)}
                            data-testid="calendar-bar"
                            data-source={e.source}
                            data-booking={e.id}
                            className={cn(
                              "absolute top-1.5 flex h-8 items-center overflow-hidden whitespace-nowrap rounded-sm border px-2 text-left text-micro font-semibold shadow-sm",
                              "hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink",
                              bar.clippedStart && "rounded-l-none border-l-0",
                              bar.clippedEnd && "rounded-r-none border-r-0",
                            )}
                            style={{ left: bar.col * CELL + (bar.clippedStart ? 0 : 3), width: bar.span * CELL - (bar.clippedStart ? 0 : 3) - (bar.clippedEnd ? 0 : 3), background: s.background, color: s.color, borderColor: s.border }}
                          >
                            <span className="truncate">
                              {bar.span > 1 ? `${SOURCE_SHORT[e.source]} · ${e.source === "OWNER" ? "bloqué" : (e.guestName ?? "voyageur")}` : SOURCE_SHORT[e.source].slice(0, 3)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Agenda({ listings, byListing, onOpen }: { listings: CalendarListing[]; byListing: Rows; onOpen: (e: StaffBookingView) => void }) {
  const [showFree, setShowFree] = useState(false);
  const busy = listings.filter((l) => byListing.has(l.id));
  const shown = showFree ? listings : busy;
  return (
    <section className="md:hidden" data-testid="calendar-agenda" aria-label="Agenda par bien">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-ink-muted" data-testid="agenda-summary">
          {pluralize(busy.length, "bien occupé", "biens occupés")} · {pluralize(listings.length - busy.length, "libre", "libres")}
        </p>
        <label className="flex items-center gap-2 text-caption">
          <input type="checkbox" checked={showFree} onChange={(e) => setShowFree(e.target.checked)} className="size-4 accent-brand" />
          Afficher les biens libres
        </label>
      </div>
      {shown.length === 0 ? (
        <p className="rounded-lg border border-line bg-white p-4 text-ink-muted">Aucune réservation ni blocage sur la période.</p>
      ) : (
        <ul className="space-y-3">
          {shown.map((l) => {
            const items = byListing.get(l.id) ?? [];
            return (
              <li key={l.id} className="rounded-lg border border-line bg-white" data-testid="agenda-listing" data-listing={l.id}>
                <h3 className="border-b border-line-soft px-4 py-2.5">
                  <span className="block truncate font-semibold">{l.title}</span>
                  <span className="block text-caption text-ink-muted">{l.placeName}</span>
                </h3>
                {items.length === 0 ? (
                  <p className="px-4 py-3 text-caption text-ink-muted">Libre sur toute la période.</p>
                ) : (
                  <ul className="divide-y divide-line-soft">
                    {items.map(({ entry: e }) => (
                      <li key={e.id}>
                        <button
                          type="button"
                          onClick={() => onOpen(e)}
                          aria-label={barLabel(e)}
                          data-testid="agenda-item"
                          data-source={e.source}
                          className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2"
                        >
                          <SourceSwatch source={e.source} className="h-9 w-2" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{bookingTitle(e)}</span>
                            <span className="block text-caption text-ink-muted">
                              {SOURCE_LABEL[e.source]} · {fmt(e.checkIn)} → {fmt(e.checkOut)} · {pluralize(e.nights, "nuit", "nuits")}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
