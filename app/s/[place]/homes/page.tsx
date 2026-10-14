import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { ListingCard } from "@/components/listing/ListingCard";
import { cn } from "@/lib/cn";
import { countLabel } from "@/lib/format";
import { searchHomes } from "@/lib/server/catalog";
import { guestsSummary, parseSearchQuery, toSearchParams, type SearchQuery } from "@/lib/search/params";

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
  const result = await searchHomes(segment, q, q.page);
  const guests = guestsSummary(q);
  const n = result.total;

  return (
    <>
      <Header
        variant="compact"
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
            <p className="mt-2 text-ink-muted">
              {result.place
                ? "Essayez d'autres dates ou de réduire le nombre de voyageurs."
                : "Nous n'avons pas encore de logements ici. Essayez une autre destination."}
            </p>
          </div>
        ) : (
          <>
            <h2 className="sr-only">Logements</h2>
            <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {result.cards.map((c, i) => (
                <ListingCard key={c.id} card={c} variant="grid" loadingHint={i === 0 ? "lcp" : i < 4 ? "eager" : undefined} />
              ))}
            </div>
            <Pagination segment={segment} q={q} page={result.page} pageCount={result.pageCount} />
          </>
        )}
      </main>
    </>
  );
}

function Pagination({ segment, q, page, pageCount }: { segment: string; q: SearchQuery; page: number; pageCount: number }) {
  if (pageCount <= 1) return null;
  const href = (p: number) => {
    const qs = toSearchParams({ ...q, page: p }).toString();
    return `/s/${segment}/homes${qs ? `?${qs}` : ""}`;
  };
  return (
    <nav aria-label="Pagination" className="mt-12 flex items-center justify-center gap-2">
      {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
        <Link
          key={p}
          href={href(p)}
          aria-current={p === page ? "page" : undefined}
          className={cn("grid size-8 place-items-center rounded-full font-medium", p === page ? "bg-ink text-white" : "hover:bg-surface-3")}
        >
          {p}
        </Link>
      ))}
    </nav>
  );
}

function ResultsSkeleton() {
  return (
    <>
      <Header variant="compact" />
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
