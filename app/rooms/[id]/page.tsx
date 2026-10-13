import { BadgeCheck, CableCar, CalendarDays, Leaf, MapPin, Mountain, Star } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { Amenities } from "@/components/room/Amenities";
import { BookingCard } from "@/components/room/BookingCard";
import { PhotoMosaic } from "@/components/room/PhotoMosaic";
import { getHomeIds, getListingDetail, type ListingDetail } from "@/lib/data/repo";
import { formatEuros, formatRating, pluralize } from "@/lib/format";
import { liftDistanceLabel, MIN_REVIEWS_FOR_RATING, minNightsLabel, PROPERTY_TYPE_LABEL } from "@/lib/labels";
import { touristTaxGrid } from "@/lib/tourist-tax";

/**
 * Listing page. Every home is prerendered from the catalogue (cached, tag "listings"). Availability, the price
 * and the session are client-side, in the booking card.
 *
 * With Partial Prefetching, an id that wasn't prerendered would first get the route's App Shell with a 200,
 * and only later visits the 404. `ensureStatic = "navigation"` makes that first request wait for the complete
 * render, so an unknown id gets its 404 (notFound below) straight away.
 */
export const ensureStatic = "navigation";

export async function generateStaticParams() {
  const ids = await getHomeIds();
  // Cache Components needs at least one sample; an empty catalogue builds a page that is always a 404.
  return ids.length > 0 ? ids.map((id) => ({ id })) : [{ id: "0" }];
}

export async function generateMetadata({ params }: PageProps<"/rooms/[id]">): Promise<Metadata> {
  const l = await getListingDetail((await params).id);
  if (!l) return { title: "Logement introuvable" };
  return { title: l.title, description: `${typeLabel(l)} · ${l.place.name}. ${l.description.slice(0, 150)}` };
}

const altitudeFmt = new Intl.NumberFormat("fr-FR");
const reviewDateFmt = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "Europe/Paris" });
const bathroomsFmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

const typeLabel = (l: ListingDetail) => (l.propertyType ? PROPERTY_TYPE_LABEL[l.propertyType] : "Logement");

/** "d'Orcières", "des Orres": French elision and contraction after "commune". */
function ofCommune(name: string): string {
  if (name.startsWith("Les ")) return `des ${name.slice(4)}`;
  if (name.startsWith("Le ")) return `du ${name.slice(3)}`;
  return /^[AEIOUYÉÈÊH]/i.test(name) ? `d'${name}` : `de ${name}`;
}

export default async function Page({ params }: PageProps<"/rooms/[id]">) {
  const l = await getListingDetail((await params).id);
  if (!l) notFound();

  const commune = touristTaxGrid(l.place.inseeCode).commune;
  const hasRating = l.reviewCount >= MIN_REVIEWS_FOR_RATING && l.ratingAvg !== null;
  const petsAllowed = l.amenities.some((a) => a.id === "animaux");
  const facts = [
    pluralize(l.maxGuests, "voyageur", "voyageurs"),
    l.bedrooms > 0 ? pluralize(l.bedrooms, "chambre", "chambres") : "Pas de chambre séparée",
    pluralize(l.beds, "lit", "lits"),
    `${bathroomsFmt.format(l.bathrooms)} ${l.bathrooms > 1 ? "salles de bain" : "salle de bain"}`,
  ];

  return (
    <>
      <Header variant="compact" />
      <main className="gutter mx-auto max-w-[1120px] pb-28 pt-6 md:pb-16">
        <h1 className="text-title-l font-semibold max-md:text-title">{l.title}</h1>
        <p className="mb-5 mt-2 flex flex-wrap items-center gap-x-2 text-ink-muted">
          <span className="inline-flex items-center gap-1 font-medium text-ink">
            <Star aria-hidden className="size-3.5 fill-current" />
            {hasRating ? (
              <>
                <span className="sr-only">Évaluation moyenne&nbsp;: </span>
                {formatRating(l.ratingAvg!)} · {pluralize(l.reviewCount, "commentaire", "commentaires")}
              </>
            ) : (
              "Nouveau"
            )}
          </span>
          <span aria-hidden>·</span>
          <span>{l.place.name} · Hautes-Alpes</span>
        </p>

        <PhotoMosaic photos={l.photos} title={l.title} />

        <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_372px] lg:gap-x-20">
          <section aria-labelledby="facts-title" className="lg:col-start-1 lg:row-start-1">
            <h2 id="facts-title" className="text-title font-semibold">
              {typeLabel(l)} · {l.place.name}
            </h2>
            <p data-testid="listing-facts" className="mt-1 text-body-l">
              {facts.join(" · ")}
            </p>
            <ul className="mt-6 space-y-5 border-y border-line py-6">
              <Fact icon={BadgeCheck} title={l.stars ? `Meublé de tourisme classé ${l.stars} ★` : "Meublé non classé"} testId="classification">
                {l.stars
                  ? "Classement officiel des meublés de tourisme."
                  : "Ce logement n'a pas de classement officiel\u00a0: la taxe de séjour suit le tarif des meublés non classés."}
              </Fact>
              <Fact icon={CableCar} title={liftDistanceLabel(l.liftDistanceM)}>
                {l.liftDistanceM <= 50 ? "Départ et retour skis aux pieds." : `Remontée mécanique la plus proche à ${l.liftDistanceM} m.`}
              </Fact>
              {l.place.altitudeM && (
                <Fact icon={Mountain} title={`Station à ${altitudeFmt.format(l.place.altitudeM)} m d'altitude`}>
                  {l.place.name} · {l.place.tagline}
                </Fact>
              )}
              <Fact icon={CalendarDays} title="Arrivée n'importe quel jour">
                {minNightsLabel(l.minNights)}.
              </Fact>
            </ul>
          </section>

          <aside aria-label="Réservation" className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <div className="lg:sticky lg:top-[105px]">
              <Suspense fallback={<div className="h-[260px] animate-pulse rounded-lg border border-line bg-surface-2" />}>
                <BookingCard listingId={l.id} nightlyCents={l.priceCents} maxGuests={l.maxGuests} minNights={l.minNights} petsAllowed={petsAllowed} />
              </Suspense>
            </div>
          </aside>

          <div className="space-y-10 lg:col-start-1 lg:row-start-2">
            <section aria-labelledby="host-title" className="flex items-center gap-4">
              <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-full bg-ink text-title-s font-semibold uppercase text-white">
                {l.host.name.trim()[0] ?? "?"}
              </span>
              <div>
                <h2 id="host-title" className="text-body-l font-semibold">
                  Hôte&nbsp;: {l.host.name}
                </h2>
                <p className="text-ink-muted">{l.host.isProfessional ? "Professionnel" : "Particulier"}</p>
              </div>
            </section>

            <section aria-labelledby="description-title">
              <h2 id="description-title" className="mb-3 text-title font-semibold">
                À propos de ce logement
              </h2>
              <p className="whitespace-pre-line text-body-l leading-6">{l.description}</p>
            </section>

            <section aria-labelledby="amenities-title">
              <h2 id="amenities-title" className="mb-5 text-title font-semibold">
                Ce que propose ce logement
              </h2>
              <Amenities amenities={l.amenities} />
            </section>

            <section aria-labelledby="legal-title" className="rounded-lg bg-surface-2 p-6">
              <h2 id="legal-title" className="mb-3 text-title-s font-semibold">
                Informations légales
              </h2>
              <dl className="space-y-2" data-testid="legal">
                <div>
                  <dt className="inline">Numéro d&apos;enregistrement&nbsp;: </dt>
                  <dd className="inline font-semibold tabular-nums">{l.registrationNumber}</dd>
                </div>
                <div>
                  <dt className="inline">Classement&nbsp;: </dt>
                  <dd className="inline font-semibold">{l.stars ? `meublé de tourisme ${l.stars} ★` : "non classé"}</dd>
                </div>
                <div>
                  <dt className="inline">
                    <Leaf aria-hidden className="mr-1.5 inline size-4 align-[-3px] text-success" />
                    Diagnostic de performance énergétique (DPE)&nbsp;:{" "}
                  </dt>
                  <dd className="inline font-semibold">{l.dpeClass ? `classe ${l.dpeClass}` : "non communiqué"}</dd>
                </div>
              </dl>
            </section>

            <section aria-labelledby="reviews-title">
              <h2 id="reviews-title" className="mb-5 flex items-center gap-2 text-title font-semibold">
                <Star aria-hidden className="size-5 fill-current" />
                {hasRating
                  ? `${formatRating(l.ratingAvg!)} · ${pluralize(l.reviewCount, "commentaire", "commentaires")}`
                  : l.reviewCount > 0
                    ? pluralize(l.reviewCount, "commentaire", "commentaires")
                    : "Pas encore de commentaire"}
              </h2>
              {l.reviews.length > 0 && (
                <ul className="grid gap-8 md:grid-cols-2">
                  {l.reviews.map((r) => (
                    <li key={r.id}>
                      <p className="font-semibold">{r.author.name}</p>
                      <p className="mb-2 text-micro text-ink-muted">
                        <span aria-hidden>{"★".repeat(r.rating)}</span>
                        <span className="sr-only">Note&nbsp;: {r.rating} sur 5</span> · {reviewDateFmt.format(new Date(r.createdAt))}
                      </p>
                      <p className="leading-6">{r.body}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="location-title">
              <h2 id="location-title" className="mb-2 text-title font-semibold">
                Où se situe le logement
              </h2>
              <p className="flex items-center gap-2 text-body-l">
                <MapPin aria-hidden className="size-5 shrink-0" strokeWidth={1.75} />
                {l.place.name}, commune {ofCommune(commune)} (Hautes-Alpes), {l.place.country}
              </p>
            </section>
          </div>
        </div>
      </main>
      <Footer />
      <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between border-t border-line bg-white px-6 py-3 md:hidden">
        <p>
          <span className="font-semibold">{formatEuros(l.priceCents)}</span> par nuit
          <span className="block text-micro text-ink-muted">{minNightsLabel(l.minNights)}</span>
        </p>
        <a href="#reserver" className="inline-flex h-12 items-center rounded-sm bg-brand-gradient px-6 font-semibold text-white">
          Réserver
        </a>
      </div>
    </>
  );
}

function Fact({ icon: Icon, title, children, testId }: { icon: typeof Star; title: string; children: React.ReactNode; testId?: string }) {
  return (
    <li className="flex gap-4" data-testid={testId}>
      <Icon aria-hidden className="mt-0.5 size-6 shrink-0" strokeWidth={1.5} />
      <div>
        <p className="font-semibold">{title}</p>
        <p className="text-ink-muted">{children}</p>
      </div>
    </li>
  );
}
