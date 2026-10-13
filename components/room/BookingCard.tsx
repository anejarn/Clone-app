"use client";

import { addDays as addDaysToDate, format, parseISO, startOfToday } from "date-fns";
import { ChevronDown } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { GuestsPicker } from "@/components/search/GuestsPicker";
import { LazyCalendar } from "@/components/search/LazyCalendar";
import { datesLabel } from "@/components/search/summary";
import { Button } from "@/components/ui/Button";
import { useSession } from "@/lib/auth-client";
import { cn } from "@/lib/cn";
import { formatEuros, formatPrice } from "@/lib/format";
import { minNightsLabel } from "@/lib/labels";
import { guestsSummary, parseSearchQuery, toSearchParams, type GuestCounts } from "@/lib/search/params";
import { isDayDisabled, nightsBetween, pickDay, type BookedRange } from "@/lib/stay-calendar";

/** Same window as the server (lib/server/bookings.ts BOOKING_WINDOW_DAYS). */
const BOOKING_WINDOW_DAYS = 365;

/** GET /api/listings/:id/quote: the guest-facing lines only. */
interface Quote {
  available: boolean;
  nights: number;
  nightlyCents: number;
  stayCents: number;
  cleaningFeeCents: number;
  touristTaxCents: number;
  totalCents: number;
  minNights: number;
}

/** The last answer of the quote API, for the stay (query string) it was asked about. */
type QuoteResult = { key: string; quote: Quote; error?: undefined } | { key: string; quote?: undefined; error: string };

/** Calendar days are local midnights; the API and the URL use yyyy-MM-dd. */
const toKey = (d: Date) => format(d, "yyyy-MM-dd");

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (body.error?.message) return body.error.message;
  } catch {
    // Not JSON: fall through to the generic message.
  }
  return "Une erreur est survenue. Réessayez.";
}

/**
 * Sticky booking card of the listing page: dates (booked nights and the minimum stay disabled), guests within
 * the listing's capacity, the live price from the quote API, and "Réserver". Signed-out visitors go to the
 * login page and come back to this listing with their choices; signed-in ones book and land on /trips.
 * Starting values come from the URL (?checkin=&checkout=&adults=…), as search results link here with them.
 */
export function BookingCard({
  listingId,
  nightlyCents,
  maxGuests,
  minNights,
  petsAllowed,
}: {
  listingId: string;
  nightlyCents: number;
  maxGuests: number;
  minNights: number;
  petsAllowed: boolean;
}) {
  const router = useRouter();
  const session = useSession();
  const searchParams = useSearchParams();
  const initial = useMemo(() => parseSearchQuery(new URLSearchParams(searchParams.toString())), [searchParams]);
  const [checkIn, setCheckIn] = useState<string | undefined>(initial.checkin);
  const [checkOut, setCheckOut] = useState<string | undefined>(initial.checkout);
  const [guests, setGuests] = useState<GuestCounts>({
    adults: Math.max(1, initial.adults),
    children: initial.children,
    infants: initial.infants,
    pets: petsAllowed ? initial.pets : 0,
  });
  const [panel, setPanel] = useState<"dates" | "guests" | null>(null);
  const [booked, setBooked] = useState<BookedRange[]>([]);
  const [result, setResult] = useState<QuoteResult | null>(null);
  const [bookError, setBookError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = { dates: useId(), guests: useId(), error: useId() };
  const datesToggle = useRef<HTMLButtonElement>(null);

  const nights = checkIn && checkOut ? nightsBetween(checkIn, checkOut) : 0;
  const tooShort = nights > 0 && nights < minNights;

  // Booked nights for the calendar. A failure only means nothing is greyed out: the server still refuses.
  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/listings/${listingId}/availability`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { booked?: BookedRange[] } | null) => body?.booked && setBooked(body.booked))
      .catch(() => {});
    return () => ctrl.abort();
  }, [listingId]);

  // Live price for complete, long-enough stays.
  const quoteKey = checkIn && checkOut && !tooShort ? toSearchParams({ checkin: checkIn, checkout: checkOut, ...guests }).toString() : null;
  useEffect(() => {
    if (!quoteKey) return;
    const ctrl = new AbortController();
    fetch(`/api/listings/${listingId}/quote?${quoteKey}`, { signal: ctrl.signal })
      .then(async (r) => setResult(r.ok ? { key: quoteKey, quote: (await r.json()) as Quote } : { key: quoteKey, error: await errorMessage(r) }))
      .catch((e: unknown) => {
        if ((e as Error).name !== "AbortError") setResult({ key: quoteKey, error: "Impossible de calculer le prix. Vérifiez votre connexion." });
      });
    return () => ctrl.abort();
  }, [listingId, quoteKey]);

  const today = startOfToday();
  const range = { from: checkIn ? parseISO(checkIn) : undefined, to: checkOut ? parseISO(checkOut) : undefined };
  const calendarRules = {
    booked,
    minNights,
    first: toKey(today),
    last: toKey(addDaysToDate(today, BOOKING_WINDOW_DAYS)),
    pendingCheckIn: checkIn && !checkOut ? checkIn : undefined,
  };

  // Only an answer about the current stay counts; anything older is a stale price.
  const current = quoteKey !== null && result?.key === quoteKey ? result : null;
  const loading = quoteKey !== null && !current;
  const quote = current?.quote;
  const unavailable = !!quote && !quote.available;
  const message =
    bookError ??
    (tooShort ? `Ce logement se réserve pour ${minNights}\u00a0nuits minimum.` : null) ??
    (unavailable ? "Ces dates ne sont plus disponibles." : null) ??
    current?.error ??
    null;

  async function reserve() {
    setBookError(null);
    if (!checkIn || !checkOut) {
      setPanel("dates");
      setBookError("Choisissez vos dates d'arrivée et de départ.");
      return;
    }
    if (tooShort || unavailable || !quote) return;
    const here = `/rooms/${listingId}?${toSearchParams({ checkin: checkIn, checkout: checkOut, ...guests }).toString()}`;
    if (!session.data) {
      router.push(`/login?next=${encodeURIComponent(here)}`);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId, checkIn, checkOut, ...guests }),
      });
      if (res.status === 401) {
        router.push(`/login?next=${encodeURIComponent(here)}`);
        return;
      }
      if (!res.ok) {
        setBookError(await errorMessage(res));
        setBusy(false);
        return;
      }
      router.push("/trips");
      router.refresh();
    } catch {
      setBookError("Impossible de joindre le serveur. Réessayez.");
      setBusy(false);
    }
  }

  return (
    <div id="reserver" data-testid="booking-card" className="scroll-mt-28 rounded-lg border border-line p-6 shadow-e3">
      <p className="mb-5 text-body-l">
        {quote?.available ? (
          <>
            <span className="text-title font-semibold">{formatPrice(quote.totalCents)}</span> au total pour {nights}&nbsp;nuits
          </>
        ) : (
          <>
            <span className="text-title font-semibold">{formatEuros(nightlyCents)}</span> par nuit
          </>
        )}
      </p>

      <div className="rounded-sm border border-ink-faint">
        <button
          ref={datesToggle}
          type="button"
          aria-expanded={panel === "dates"}
          aria-controls={ids.dates}
          onClick={() => setPanel(panel === "dates" ? null : "dates")}
          className="grid w-full grid-cols-2 text-left"
        >
          <span className="border-r border-ink-faint px-3 py-2.5">
            <span className="block text-[10px] font-bold uppercase tracking-wide">Arrivée</span>
            <span className={cn("block", !checkIn && "text-ink-muted")}>{checkIn ? format(parseISO(checkIn), "dd/MM/yyyy") : "Ajouter une date"}</span>
          </span>
          <span className="px-3 py-2.5">
            <span className="block text-[10px] font-bold uppercase tracking-wide">Départ</span>
            <span className={cn("block", !checkOut && "text-ink-muted")}>{checkOut ? format(parseISO(checkOut), "dd/MM/yyyy") : "Ajouter une date"}</span>
          </span>
          <span className="sr-only">{panel === "dates" ? "Fermer le calendrier" : "Choisir les dates"}</span>
        </button>
        <button
          type="button"
          aria-expanded={panel === "guests"}
          aria-controls={ids.guests}
          onClick={() => setPanel(panel === "guests" ? null : "guests")}
          className="flex w-full items-center justify-between border-t border-ink-faint px-3 py-2.5 text-left"
        >
          <span>
            <span className="block text-[10px] font-bold uppercase tracking-wide">Voyageurs</span>
            <span className="block">{guestsSummary(guests)}</span>
          </span>
          <ChevronDown aria-hidden className={cn("size-4 transition-transform", panel === "guests" && "rotate-180")} />
        </button>
      </div>

      {panel === "dates" && (
        <div id={ids.dates} role="group" aria-label="Dates du séjour" className="stay-calendar mt-4">
          <p className="mb-2 text-ink-muted">
            {checkIn && !checkOut ? "Choisissez la date de départ" : "Choisissez la date d'arrivée"} · {minNightsLabel(minNights)}
          </p>
          <div className="flex justify-center">
            <LazyCalendar
              months={1}
              value={range}
              onChange={() => {}}
              endMonth={addDaysToDate(today, BOOKING_WINDOW_DAYS)}
              isDisabled={(d) => isDayDisabled(toKey(d), calendarRules)}
              onPick={(d) => {
                const next = pickDay(toKey(d), { checkIn, checkOut });
                setCheckIn(next.checkIn);
                setCheckOut(next.checkOut);
                setBookError(null);
                if (next.checkOut) {
                  // The calendar closes: keep keyboard focus in the card instead of losing it to <body>.
                  setPanel(null);
                  datesToggle.current?.focus();
                }
              }}
            />
          </div>
          <div className="mt-2 flex justify-between">
            <button
              type="button"
              className="font-semibold underline"
              onClick={() => {
                setCheckIn(undefined);
                setCheckOut(undefined);
                setBookError(null);
              }}
            >
              Effacer les dates
            </button>
            <button type="button" className="font-semibold underline" onClick={() => setPanel(null)}>
              Fermer
            </button>
          </div>
        </div>
      )}
      {panel === "guests" && (
        <div id={ids.guests} role="group" aria-label="Voyageurs" className="mt-4">
          <GuestsPicker
            value={guests}
            onChange={(g) => {
              setGuests(g);
              setBookError(null);
            }}
            maxGuests={maxGuests} petsAllowed={petsAllowed} minAdults={1} />
          <p className="mt-3 text-micro text-ink-muted">
            {maxGuests}&nbsp;voyageurs maximum, sans compter les bébés. La taxe de séjour est due pour chaque adulte.
          </p>
        </div>
      )}

      <Button
        variant="primary"
        className="mt-4 w-full"
        onClick={reserve}
        disabled={busy || session.isPending || tooShort || unavailable || loading}
        aria-describedby={message ? ids.error : undefined}
      >
        {busy ? "Réservation…" : "Réserver"}
      </Button>
      {message && (
        <p id={ids.error} role="alert" className="mt-3 text-error">
          {message}
        </p>
      )}

      {!checkIn || !checkOut ? (
        <p className="mt-3 text-center text-ink-muted">
          Arrivée n&apos;importe quel jour · {minNightsLabel(minNights)}
        </p>
      ) : loading ? (
        <div aria-busy className="mt-5 space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-5 animate-pulse rounded bg-line-soft" />
          ))}
        </div>
      ) : quote?.available ? (
        <PriceBreakdown quote={quote} adults={guests.adults} dates={datesLabel(range)} />
      ) : null}
    </div>
  );
}

function PriceBreakdown({ quote, adults, dates }: { quote: Quote; adults: number; dates?: string }) {
  const lines: [string, number][] = [
    [`${formatPrice(quote.nightlyCents)} × ${quote.nights}\u00a0nuits`, quote.stayCents],
    ...(quote.cleaningFeeCents > 0 ? [["Frais de ménage", quote.cleaningFeeCents] as [string, number]] : []),
    [`Taxe de séjour (${adults}\u00a0adulte${adults > 1 ? "s" : ""})`, quote.touristTaxCents],
  ];
  return (
    <div data-testid="price-breakdown" className="mt-5">
      <h3 className="sr-only">Détail du prix{dates ? ` (${dates})` : ""}</h3>
      <dl className="space-y-3">
        {lines.map(([label, cents]) => (
          <div key={label} className="flex justify-between gap-4">
            <dt>{label}</dt>
            <dd className="tabular-nums">{formatPrice(cents)}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-4 border-t border-line pt-4 font-semibold">
          <dt>Total</dt>
          <dd className="tabular-nums">{formatPrice(quote.totalCents)}</dd>
        </div>
      </dl>
      <p className="mt-3 text-micro text-ink-muted">Aucun frais de service pour les voyageurs.</p>
    </div>
  );
}
