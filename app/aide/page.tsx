import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import {
  AUTH_BROADCAST_STORAGE_KEY,
  AUTH_SESSION_CACHE_COOKIE,
  AUTH_SESSION_COOKIE,
  CONSENT_COOKIE,
  CONSENT_MAX_AGE_DAYS,
  SESSION_CACHE_MINUTES,
  SESSION_DAYS,
  WISHLIST_STORAGE_KEY,
} from "@/lib/browser-storage";
import { formatPrice } from "@/lib/format";
import { TOURIST_TAX_GRIDS, type Stars, type TouristTaxGrid } from "@/lib/tourist-tax";

export const metadata: Metadata = {
  title: "Aide",
  description:
    "Réserver et annuler un logement sur Nidou, la taxe de séjour d'Orcières et des Orres, les favoris, les cookies et la page des propriétaires.",
};

/** Sections, in page order; their ids are linked from the footer and the cookie notice. */
const SECTIONS = [
  { id: "reserver", title: "Réserver un logement" },
  { id: "annuler", title: "Annuler une réservation" },
  { id: "taxe-de-sejour", title: "La taxe de séjour" },
  { id: "favoris", title: "Vos favoris" },
  { id: "proprietaires", title: "Propriétaires" },
  { id: "cookies", title: "Cookies et stockage sur votre appareil" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

const STARS: Stars[] = [1, 2, 3, 4, 5];
const percentFmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });

/** The grid's sources as links: "label (url)" or a bare url. */
function sourceLinks(grid: TouristTaxGrid) {
  return grid.sources.flatMap((source) => {
    const labelled = /^(.*?)\s*\((https?:\/\/[^\s)]+)\)$/.exec(source);
    if (labelled) return [{ href: labelled[2], label: labelled[1] }];
    if (/^https?:\/\//.test(source)) return [{ href: source, label: `Document publié sur ${new URL(source).hostname}` }];
    return [];
  });
}

export default function Page() {
  return (
    <>
      <Header variant="compact" />
      <main className="gutter mx-auto max-w-[820px] pb-16 pt-8 md:pt-12">
        <h1 className="text-display font-semibold tracking-[-0.5px] max-md:text-title-l">Aide</h1>
        <p className="mt-3 text-body-l text-ink-muted">Comment réserver, annuler, ce que comprend le prix, et ce que Nidou enregistre sur votre appareil.</p>

        <nav aria-label="Sommaire" className="mt-8 rounded-lg bg-surface-2 p-6">
          <ul className="grid gap-3 sm:grid-cols-2">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="font-medium underline-offset-2 hover:underline">
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <Section id="reserver">
          <p>
            Vous arrivez le jour de votre choix. Chaque logement a une durée minimale de séjour, indiquée sur son annonce&nbsp;: 2&nbsp;nuits
            pour la plupart, 3&nbsp;pour certains.
          </p>
          <p>
            Dès que vous avez choisi vos dates, le prix affiché est tout compris&nbsp;: le prix des nuits, les frais de ménage et la taxe de
            séjour, chacun sur sa ligne. Nidou ne facture aucun frais de service aux voyageurs.
          </p>
          <p>
            Pour réserver, connectez-vous ou créez un compte. Votre réservation est confirmée immédiatement et apparaît dans{" "}
            <Link href="/trips" className="font-semibold underline underline-offset-2">
              Voyages
            </Link>
            .
          </p>
        </Section>

        <Section id="annuler">
          <p>
            Vous pouvez annuler une réservation depuis{" "}
            <Link href="/trips" className="font-semibold underline underline-offset-2">
              Voyages
            </Link>{" "}
            jusqu&apos;à la veille de votre arrivée. C&apos;est la date du jour dans la station qui compte&nbsp;: le jour de l&apos;arrivée,
            l&apos;annulation n&apos;est plus possible.
          </p>
          <p>Les dates d&apos;une réservation annulée redeviennent disponibles pour d&apos;autres voyageurs.</p>
        </Section>

        <Section id="taxe-de-sejour">
          <p>
            La taxe de séjour est fixée par la commune de la station. Elle est due par adulte et par nuit&nbsp;; les mineurs en sont exonérés.
            Son montant dépend du classement du logement en meublé de tourisme, de 1 à 5&nbsp;étoiles. Pour un logement non classé, elle
            représente un pourcentage du prix de la nuit par occupant, plafonné par la commune.
          </p>
          <p>
            Elle est comprise dans le total affiché avec vos dates et détaillée sur sa propre ligne. Les tarifs ci-dessous incluent la taxe
            additionnelle de 10&nbsp;% du département des Hautes-Alpes.
          </p>
          <div className="grid gap-8 pt-3 sm:grid-cols-2">
            {Object.values(TOURIST_TAX_GRIDS).map((grid) => (
              <div key={grid.inseeCode}>
                <h3 className="text-body-l font-semibold">Commune {grid.commune === "Les Orres" ? "des Orres" : `d'${grid.commune}`}</h3>
                <p className="text-ink-muted">Tarifs {grid.validity}</p>
                <table className="mt-3 w-full border-collapse text-left">
                  <caption className="sr-only">Taxe de séjour par adulte et par nuit, commune de {grid.commune}</caption>
                  <thead>
                    <tr className="border-b border-line">
                      <th scope="col" className="py-2 pr-3 font-medium">
                        Classement
                      </th>
                      <th scope="col" className="py-2 pl-3 text-right font-medium">
                        Par adulte et par nuit
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {STARS.map((n) => (
                      <tr key={n}>
                        <th scope="row" className="whitespace-nowrap py-2 pr-3 font-normal">
                          Meublé {n}&nbsp;★
                        </th>
                        <td className="py-2 pl-3 text-right tabular-nums">{formatPrice(grid.classified[n])}</td>
                      </tr>
                    ))}
                    <tr>
                      <th scope="row" className="py-2 pr-3 font-normal">
                        Non classé
                      </th>
                      <td className="py-2 pl-3 text-right">
                        {percentFmt.format(grid.unclassifiedBps / 100)}&nbsp;% du prix de la nuit par occupant, au plus {formatPrice(grid.unclassifiedCapCents)}
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p className="mt-2 text-micro text-ink-muted">
                  Sources&nbsp;:{" "}
                  {sourceLinks(grid).map((src, i) => (
                    <span key={src.href}>
                      {i > 0 && " · "}
                      <a href={src.href} className="underline underline-offset-2" rel="noopener noreferrer">
                        {src.label}
                      </a>
                    </span>
                  ))}
                </p>
              </div>
            ))}
          </div>
        </Section>

        <Section id="favoris">
          <p>
            Sans compte, les logements que vous enregistrez avec le cœur sont gardés sur cet appareil, dans ce navigateur. Quand vous vous
            connectez, ils sont ajoutés à votre compte et retirés de l&apos;appareil&nbsp;: vous les retrouvez ensuite dans{" "}
            <Link href="/wishlists" className="font-semibold underline underline-offset-2">
              Favoris
            </Link>{" "}
            dès que vous êtes connecté.
          </p>
        </Section>

        <Section id="proprietaires">
          <p>
            Vous avez un appartement, un studio ou un chalet à Orcières-Merlette 1850 ou aux Orres&nbsp;? Notre offre et le formulaire pour nous
            présenter votre logement sont sur la page{" "}
            <Link href="/devenir-hote" className="font-semibold underline underline-offset-2">
              Devenir hôte
            </Link>
            .
          </p>
        </Section>

        <Section id="cookies">
          <p>
            Nidou n&apos;utilise aucun traceur de mesure d&apos;audience ni de publicité. Voici tout ce que le site enregistre dans votre
            navigateur&nbsp;:
          </p>
          <ul data-testid="storage-list" className="divide-y divide-line border-y border-line">
            <StorageRow name={AUTH_SESSION_COOKIE} kind="Cookie" lifetime={`${SESSION_DAYS}\u00a0jours`}>
              Vous garde connecté. Posé quand vous vous connectez, supprimé à la déconnexion.
            </StorageRow>
            <StorageRow name={AUTH_SESSION_CACHE_COOKIE} kind="Cookie" lifetime={`${SESSION_CACHE_MINUTES}\u00a0minutes`}>
              Copie chiffrée de votre session, pour ne pas la relire à chaque page. Posé quand vous êtes connecté.
            </StorageRow>
            <StorageRow name={CONSENT_COOKIE} kind="Cookie" lifetime={`${CONSENT_MAX_AGE_DAYS}\u00a0jours`}>
              Retient que vous avez fermé le bandeau d&apos;information sur les cookies.
            </StorageRow>
            <StorageRow name={WISHLIST_STORAGE_KEY} kind="Stockage local" lifetime="jusqu'à votre connexion">
              Vos favoris enregistrés sans compte, sur cet appareil.
            </StorageRow>
            <StorageRow name={AUTH_BROADCAST_STORAGE_KEY} kind="Stockage local" lifetime="jusqu'à ce que vous effaciez les données du site">
              Prévient vos autres onglets ouverts quand vous vous déconnectez. Ne contient aucune donnée personnelle&nbsp;: un événement, un
              identifiant d&apos;onglet tiré au hasard et une date.
            </StorageRow>
          </ul>
          <p className="text-micro text-ink-muted">
            Sur une connexion sécurisée (HTTPS), les deux cookies de connexion portent le préfixe «&nbsp;__Secure-&nbsp;».
          </p>
        </Section>
      </main>
      <Footer />
      <MobileBottomNav active="explore" />
    </>
  );
}

function Section({ id, children }: { id: SectionId; children: ReactNode }) {
  const title = SECTIONS.find((s) => s.id === id)!.title;
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mt-12 scroll-mt-28 space-y-3 text-body-l leading-6">
      <h2 id={`${id}-title`} className="mb-4 text-title font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function StorageRow({ name, kind, lifetime, children }: { name: string; kind: string; lifetime: string; children: ReactNode }) {
  return (
    <li className="py-4">
      <p className="flex flex-wrap items-baseline gap-x-3">
        <code className="font-mono text-body font-semibold">{name}</code>
        <span className="text-micro text-ink-muted">
          {kind} · {lifetime}
        </span>
      </p>
      <p className="mt-1">{children}</p>
    </li>
  );
}
