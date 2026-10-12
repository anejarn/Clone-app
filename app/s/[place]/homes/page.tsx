import type { Metadata } from "next";
import { Suspense } from "react";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { ListingCard } from "@/components/listing/ListingCard";
import { getPlaces, searchHomes } from "@/lib/data/repo";
import { countLabel } from "@/lib/format";
import { guestsSummary, parseSearchQuery } from "@/lib/search/params";

export const metadata: Metadata = { title: "Résultats de recherche" };

export default function Page(props: PageProps<"/s/[place]/homes">) {
  return (
    <>
      <Suspense fallback={<ResultsSkeleton />}>
        <Results {...props} />
      </Suspense>
      <Footer />
      <MobileBottomNav active="explore" />
    </>
  );
}

async function Results({ params, searchParams }: PageProps<"/s/[place]/homes">) {
  const [{ place: segment }, raw] = await Promise.all([params, searchParams]);
  const q = parseSearchQuery(raw);
  const result = await searchHomes(segment, q);
  const guests = guestsSummary(q);
  const n = result.cards.length;

  return (
    <>
      <Header
        variant="compact"
        places={getPlaces()}
        initial={{
          where: result.label,
          placeSlug: result.place?.slug,
          checkin: q.checkin,
          checkout: q.checkout,
          guests: { adults: q.adults, children: q.children, infants: q.infants, pets: q.pets },
        }}
      />
      <main className="gutter mx-auto max-w-[1760px] pb-16 pt-6">
        <h1 className="mb-1 text-title-s font-semibold">
          {n === 0 ? "Aucun résultat" : [countLabel(n), result.label].filter(Boolean).join(" · ")}
        </h1>
        <p className="mb-6 text-ink-muted">
          {[result.nights ? `${result.nights} nuit${result.nights > 1 ? "s" : ""}` : "Dates flexibles", guests || null, "Prix toutes taxes et frais compris"]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {n === 0 ? (
          <div className="max-w-md py-12">
            <p className="text-title-s font-semibold">Aucune correspondance exacte</p>
            <p className="mt-2 text-ink-muted">Essayez de modifier votre destination ou de réduire le nombre de voyageurs.</p>
          </div>
        ) : (
          <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {result.cards.map((c, i) => (
              <ListingCard key={c.id} card={c} variant="grid" priority={i < 4} />
            ))}
          </div>
        )}
      </main>
    </>
  );
}

function ResultsSkeleton() {
  return (
    <>
      <Header variant="compact" places={getPlaces()} />
      <main className="gutter mx-auto max-w-[1760px] pb-16 pt-6" aria-busy>
        <div className="mb-8 h-6 w-64 animate-pulse rounded bg-line-soft" />
        <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i}>
              <div className="aspect-[20/19] animate-pulse rounded-lg bg-line-soft" />
              <div className="mt-3 h-4 w-3/4 animate-pulse rounded bg-line-soft" />
              <div className="mt-2 h-4 w-1/2 animate-pulse rounded bg-line-soft" />
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
