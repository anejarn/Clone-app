import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { formatPrice, formatStayDates } from "@/lib/format";
import { PROPERTY_TYPE_LABEL } from "@/lib/labels";
import { guestsSummary } from "@/lib/search/params";
import { getCurrentUser } from "@/lib/server/auth";
import { listBookings, utcToday, type BookingView } from "@/lib/server/bookings";
import { publicOrgId } from "@/lib/server/org";
import { CancelButton } from "./CancelButton";

export const metadata: Metadata = { title: "Mes séjours" };

export default function Page() {
  return (
    <>
      <Header variant="compact" />
      <main className="gutter mx-auto min-h-[60vh] max-w-[1120px] pb-16 pt-8">
        <h1 className="mb-8 text-display font-semibold">Mes séjours</h1>
        <Suspense fallback={<p className="text-ink-muted">Chargement…</p>}>
          <Trips />
        </Suspense>
      </main>
      <Footer />
      <MobileBottomNav active="trips" />
    </>
  );
}

async function Trips() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/trips");
  const bookings = await listBookings(await publicOrgId(), user.id);
  const today = utcToday();
  const upcoming = bookings.filter((b) => b.status === "CONFIRMED" && b.checkOut > today).reverse();
  const past = bookings.filter((b) => !upcoming.includes(b));

  if (bookings.length === 0) {
    return (
      <div className="max-w-md border-t border-line pt-8">
        <p className="text-title-s font-semibold">Aucun séjour pour l&apos;instant</p>
        <p className="mt-2 text-ink-muted">Vos séjours à Marrakech s&apos;afficheront ici, avec leurs dates, les voyageurs et le total.</p>
        <Link href="/homes" className="mt-6 inline-flex h-12 items-center rounded-sm border border-ink px-6 font-semibold">
          Voir les logements
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-12">
      {upcoming.length > 0 && <TripList title="Séjours à venir" bookings={upcoming} today={today} />}
      {past.length > 0 && <TripList title="Séjours passés et annulés" bookings={past} today={today} />}
    </div>
  );
}

function TripList({ title, bookings, today }: { title: string; bookings: BookingView[]; today: Date }) {
  return (
    <section>
      <h2 className="mb-4 text-title font-semibold">{title}</h2>
      <ul className="grid gap-4 md:grid-cols-2">
        {bookings.map((b) => {
          const l = b.listing;
          const type = l.propertyType ? PROPERTY_TYPE_LABEL[l.propertyType] : l.title;
          return (
            <li key={b.id} data-testid="trip" className="flex gap-4 rounded-lg border border-line p-4">
              <div className="relative size-24 shrink-0 overflow-hidden rounded-md bg-line-soft">
                {l.photos[0] && <Image src={l.photos[0].url} alt="" fill sizes="96px" className="object-cover" />}
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="truncate font-semibold">
                  {type} · {l.place.name}
                </p>
                <p className="text-ink-muted">
                  {formatStayDates(b.checkIn, b.checkOut)} · {guestsSummary(b)}
                </p>
                <p>
                  {/* Only platform bookings can lack an amount (not known yet). */}
                  {b.totalCents !== null && (
                    <>
                      Total <span className="font-semibold">{formatPrice(b.totalCents)}</span>
                    </>
                  )}
                  {b.status === "CANCELLED" && <span className="ml-2 rounded-pill bg-surface-3 px-2 py-0.5 text-micro font-semibold">Annulée</span>}
                </p>
                {b.status === "CONFIRMED" && b.source === "DIRECT" && b.checkIn > today && <CancelButton bookingId={b.id} />}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
