import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { ListingCard } from "@/components/listing/ListingCard";
import { inspiration } from "@/lib/content";
import { getHomeSections } from "@/lib/data/repo";
import { CarouselSection } from "./CarouselSection";
import { InspirationGrid } from "./InspirationGrid";
import { ResortTile } from "./Tiles";

export async function HomePage() {
  const sections = await getHomeSections();
  // The first listing photos are the largest images above the fold on phones; on desktop the resort tiles are.
  const firstListings = sections.findIndex((s) => s.kind === "listings");
  return (
    <>
      <Header variant="home" />
      <main className="gutter mx-auto max-w-[1760px] pb-12 pt-6 md:pt-8">
        <div className="mb-8 max-w-[760px]">
          <h1 className="text-title-l font-semibold tracking-[-0.3px] max-md:text-title">
            Les appartements de ski d&apos;Orcières-Merlette et des Orres
          </h1>
          <p className="mt-2 text-body-l text-ink-muted max-md:text-body">
            Arrivée n&apos;importe quel jour, à partir de 2&nbsp;nuits. Avec vos dates, le prix affiché est tout compris, taxe de séjour incluse.
          </p>
        </div>
        {sections.map((s, i) =>
          s.kind === "resorts" ? (
            <section key={s.title} aria-labelledby="resorts-title" className="mb-10">
              <h2 id="resorts-title" className="mb-4 text-title font-semibold tracking-[-0.2px] max-md:text-title-s">
                {s.title}
              </h2>
              <div className="grid grid-cols-2 gap-3 md:gap-6">
                {s.places.map((p, j) => (
                  <ResortTile key={p.slug} place={p} priority={j === 0} />
                ))}
              </div>
            </section>
          ) : (
            <CarouselSection key={s.title} title={s.title} href={s.href}>
              {s.cards.map((c, j) => (
                <ListingCard key={c.id} card={c} loadingHint={i === firstListings && j < 2 ? "lcp" : i <= firstListings + 1 && j < 4 ? "eager" : undefined} />
              ))}
            </CarouselSection>
          ),
        )}
        <section aria-labelledby="owners-title" className="flex flex-col gap-4 rounded-lg bg-surface-2 p-6 md:flex-row md:items-center md:justify-between md:p-8">
          <div>
            <h2 id="owners-title" className="text-title-s font-semibold">
              Propriétaire à Orcières-Merlette 1850 ou aux Orres&nbsp;?
            </h2>
            <p className="mt-1 text-ink-muted">
              10&nbsp;% de commission HT (12&nbsp;% TTC) sur les séjours réservés, aucun frais facturé aux voyageurs.
            </p>
          </div>
          <Link href="/devenir-hote" className="inline-flex h-12 shrink-0 items-center gap-2 self-start rounded-sm bg-ink px-6 font-semibold text-white hover:bg-black md:self-auto">
            Devenir hôte
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        </section>
      </main>
      <InspirationGrid groups={inspiration} />
      <Footer />
      <MobileBottomNav active="explore" />
    </>
  );
}
