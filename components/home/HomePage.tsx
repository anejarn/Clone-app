import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { ListingCard } from "@/components/listing/ListingCard";
import { getHomeSections, getInspiration, getPlaces, type HomeCategory } from "@/lib/data/repo";
import { CarouselSection } from "./CarouselSection";
import { InspirationGrid } from "./InspirationGrid";
import { DestinationTile, ServiceTile } from "./Tiles";

export async function HomePage({ category }: { category: HomeCategory }) {
  const sections = await getHomeSections(category);
  return (
    <>
      <Header variant="home" places={getPlaces()} />
      <main className="gutter mx-auto max-w-[1760px] pb-12 pt-8">
        <h1 className="sr-only">Page d&apos;accueil Nidou</h1>
        {sections.map((s, i) => (
          <CarouselSection key={s.title} title={s.title} href={s.kind === "listings" ? s.href : undefined}>
            {s.kind === "destinations" && s.places.map((p) => <DestinationTile key={p.slug} place={p} />)}
            {s.kind === "services" && s.services.map((sv) => <ServiceTile key={sv.slug} service={sv} />)}
            {s.kind === "listings" && s.cards.map((c, j) => <ListingCard key={c.id} card={c} priority={i < 3 && j < 4} />)}
          </CarouselSection>
        ))}
      </main>
      <InspirationGrid tabs={getInspiration()} />
      <Footer />
      <MobileBottomNav active="explore" />
    </>
  );
}
