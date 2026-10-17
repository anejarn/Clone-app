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
import { SERVICE_FEE_RATE } from "@/lib/pricing";
import { MAX_GUESTS } from "@/lib/search/params";

export const metadata: Metadata = {
  title: "Aide",
  description:
    "Rechercher un logement sur Sigma, ce que comprend le prix, vos séjours et leur annulation, les favoris, votre compte, les cookies, et l'offre de Sigma aux propriétaires.",
};

/** Sections, in page order; their ids are linked from the footer, the user menu and the cookie notice. */
const SECTIONS = [
  { id: "rechercher", title: "Rechercher un logement" },
  { id: "sejours", title: "Vos séjours" },
  { id: "favoris", title: "Vos favoris" },
  { id: "compte", title: "Votre compte" },
  { id: "cookies", title: "Cookies et stockage sur votre appareil" },
  { id: "proprietaires", title: "Confier votre bien à Sigma" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

const link = "font-semibold underline underline-offset-2";
const servicePercent = `${Math.round(SERVICE_FEE_RATE * 100)} %`;
/** Sigma's management offer to owners, from the business plan. */
const OWNER_COMMISSION = "20 %";
const OWNER_SERVICES = [
  "la mise en ligne de votre bien sur plusieurs plateformes de location",
  "la fixation des prix",
  "l'accueil des voyageurs",
  "le ménage et le linge",
  "l'entretien et la maintenance",
  "les photos du bien",
  "un rapport mensuel",
];

export default function Page() {
  return (
    <>
      <Header variant="compact" />
      <main className="gutter mx-auto max-w-[820px] pb-16 pt-8 md:pt-12">
        <h1 className="text-display font-semibold tracking-[-0.5px] max-md:text-title-l">Aide</h1>
        <p className="mt-3 text-body-l text-ink-muted">
          Comment rechercher un logement à Marrakech, ce que comprend le prix, vos séjours, vos favoris, votre compte, ce que Sigma
          enregistre sur votre appareil, et ce que Sigma propose aux propriétaires.
        </p>

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

        <Section id="rechercher">
          <p>La barre de recherche a trois parties&nbsp;: le quartier, les dates et les voyageurs. Aucune n&apos;est obligatoire.</p>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>Quartier.</strong> Sigma propose les quartiers de Marrakech, puis ceux qui correspondent à ce que vous tapez&nbsp;;
              choisissez-en un à la souris, ou avec les flèches puis Entrée. Sans quartier, la recherche porte sur tous les logements.
            </li>
            <li>
              <strong>Dates.</strong> Choisissez la date d&apos;arrivée, puis celle de départ. Avec des dates, seuls les logements libres
              pendant tout le séjour sont affichés. Une date d&apos;arrivée seule n&apos;est pas prise en compte.
            </li>
            <li>
              <strong>Voyageurs.</strong> Adultes (18&nbsp;ans et plus), enfants (de 2 à 17&nbsp;ans), bébés (moins de 2&nbsp;ans) et
              animaux, jusqu&apos;à {MAX_GUESTS}&nbsp;adultes et enfants. Les logements affichés peuvent accueillir tous les adultes et
              enfants indiqués&nbsp;; avec un animal, seuls ceux qui acceptent les animaux apparaissent.
            </li>
          </ul>
          <p>
            Les prix sont en dirhams marocains (MAD), arrondis au dirham. Sans dates, le prix affiché est celui d&apos;une nuit, hors
            ménage. Avec des dates, c&apos;est le prix total du séjour&nbsp;: le prix de la nuit multiplié par le nombre de nuits, plus les
            frais de ménage du logement
            {SERVICE_FEE_RATE > 0 ? (
              <>, plus des frais de service de {servicePercent} de ces deux montants.</>
            ) : (
              <>. Sigma n&apos;ajoute pas de frais de service.</>
            )}
          </p>
        </Section>

        <Section id="sejours">
          <p>
            Une fois connecté, la page{" "}
            <Link href="/trips" className={link}>
              Mes séjours
            </Link>{" "}
            liste vos séjours à venir, puis vos séjours passés et annulés, avec leurs dates (JJ/MM/AAAA), le nombre de voyageurs et le
            total.
          </p>
          <p>
            Vous pouvez annuler un séjour à venir depuis cette page jusqu&apos;à la veille de votre arrivée. C&apos;est la date du jour à la
            destination qui compte&nbsp;: le jour de l&apos;arrivée, l&apos;annulation n&apos;est plus possible. Un séjour annulé reste dans
            la liste, marqué «&nbsp;Annulée&nbsp;», et ses dates redeviennent disponibles pour d&apos;autres voyageurs.
          </p>
        </Section>

        <Section id="favoris">
          <p>
            Le cœur sur un logement l&apos;ajoute à vos favoris. Sans compte, ils sont gardés sur cet appareil, dans ce navigateur. Quand
            vous vous connectez, ils sont ajoutés à votre compte et retirés de l&apos;appareil&nbsp;: vous les retrouvez ensuite dans{" "}
            <Link href="/wishlists" className={link}>
              Favoris
            </Link>{" "}
            chaque fois que vous êtes connecté.
          </p>
        </Section>

        <Section id="compte">
          <p>
            Pour créer un compte, ouvrez la page{" "}
            <Link href="/login" className={link}>
              Connexion
            </Link>
            , choisissez «&nbsp;Inscrivez-vous&nbsp;» et indiquez votre prénom, votre adresse e-mail et un mot de passe d&apos;au moins
            8&nbsp;caractères. Vous êtes connecté dès la création du compte, puis vous vous reconnectez avec la même adresse et le même
            mot de passe.
          </p>
          <p>
            Votre connexion dure {SESSION_DAYS}&nbsp;jours sur cet appareil et se prolonge quand vous revenez sur le site. Pour la fermer
            avant, déconnectez-vous depuis le menu ou la page Connexion.
          </p>
        </Section>

        <Section id="cookies">
          <p>
            Sigma n&apos;utilise aucun traceur de mesure d&apos;audience ni de publicité. Voici tout ce que le site enregistre dans votre
            navigateur&nbsp;:
          </p>
          <ul data-testid="storage-list" className="divide-y divide-line border-y border-line">
            <StorageRow name={AUTH_SESSION_COOKIE} kind="Cookie" lifetime={`${SESSION_DAYS} jours`}>
              Vous garde connecté. Posé quand vous vous connectez, supprimé à la déconnexion.
            </StorageRow>
            <StorageRow name={AUTH_SESSION_CACHE_COOKIE} kind="Cookie" lifetime={`${SESSION_CACHE_MINUTES} minutes`}>
              Copie chiffrée de votre session, pour ne pas la relire à chaque page. Posé quand vous êtes connecté, supprimé à la
              déconnexion.
            </StorageRow>
            <StorageRow name={CONSENT_COOKIE} kind="Cookie" lifetime={`${CONSENT_MAX_AGE_DAYS} jours`}>
              Retient que vous avez fermé le message sur les cookies.
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

        <Section id="proprietaires">
          <p>
            Sigma gère des locations de courte durée à Marrakech pour le compte de propriétaires. Sa rémunération est une commission de
            gestion de <strong>{OWNER_COMMISSION} des revenus locatifs</strong> de votre bien, tout compris.
          </p>
          <h3 id="gestion" className="scroll-mt-28 pt-2 text-title-s font-semibold">
            Ce que comprend la gestion
          </h3>
          <ul className="list-disc space-y-1 pl-6">
            {OWNER_SERVICES.map((s) => (
              <li key={s}>{s.charAt(0).toUpperCase() + s.slice(1)}.</li>
            ))}
          </ul>
          <p>La décoration du bien avant sa mise en location est possible en plus, sur devis.</p>
          <h3 id="autorisation" className="scroll-mt-28 pt-2 text-title-s font-semibold">
            Autorisation 80-14
          </h3>
          <p>Sigma prépare pour vous le dossier d&apos;autorisation prévu par la loi 80-14 sur l&apos;hébergement touristique.</p>
          <p data-testid="owners-next" className="rounded-md bg-brand-tint p-4 text-brand-strong">
            L&apos;espace propriétaire et un formulaire pour nous écrire arrivent dans une prochaine version du site. Ils ne sont pas encore
            disponibles.
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
