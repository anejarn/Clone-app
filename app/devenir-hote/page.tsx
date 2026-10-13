import { CalendarSync, FileCheck2, Landmark } from "lucide-react";
import type { Metadata } from "next";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { getPlaces } from "@/lib/data/repo";
import { formatPrice } from "@/lib/format";
import { COMMISSION_BPS, FOUNDING_COMMISSION_BPS, hostSplit } from "@/lib/pricing";
import { HostLeadForm } from "./HostLeadForm";

export const metadata: Metadata = {
  title: "Devenir hôte",
  description:
    "Louez votre appartement de ski d'Orcières-Merlette 1850 ou des Orres sur Nidou\u00a0: 10\u00a0% de commission HT (12\u00a0% TTC), aucun frais pour les voyageurs.",
};

/** Worked example on a 1 000 € stay (nights + cleaning), computed with the same rules as bookings. */
const EXAMPLE_BASE = 100_000;
const standard = hostSplit(EXAMPLE_BASE, COMMISSION_BPS);
const founding = hostSplit(EXAMPLE_BASE, FOUNDING_COMMISSION_BPS);

const SERVICES = [
  {
    Icon: FileCheck2,
    title: "Numéro d'enregistrement affiché",
    body: "Le numéro d'enregistrement de votre meublé est affiché sur l'annonce. Nous contrôlons son format et qu'il commence par le code INSEE de votre station.",
  },
  {
    Icon: Landmark,
    title: "Taxe de séjour collectée et reversée",
    body: "Nidou collecte la taxe de séjour auprès des voyageurs avec la réservation et la reverse à la commune.",
  },
  {
    Icon: CalendarSync,
    title: "Export de votre calendrier",
    body: "Un lien iCal par logement, à coller dans vos autres canaux de location pour y bloquer les nuits vendues sur Nidou.",
  },
];

export default async function Page() {
  const places = (await getPlaces()).map((p) => ({ slug: p.slug, name: p.name, inseeCode: p.inseeCode ?? "" }));
  return (
    <>
      <Header variant="compact" />
      <main className="pb-16">
        <section className="gutter mx-auto max-w-[1120px] pb-12 pt-8 md:pt-14">
          <p className="mb-3 font-semibold text-brand-strong">Propriétaires à Orcières-Merlette 1850 et aux Orres</p>
          <h1 className="max-w-[820px] text-display font-semibold tracking-[-0.5px] max-md:text-title-l">
            Louez votre appartement de ski sur Nidou, sans frais pour vos voyageurs
          </h1>
          <p className="mt-4 max-w-[680px] text-body-l text-ink-muted">
            Nidou est la plateforme de location courte durée des appartements de ski d&apos;Orcières-Merlette 1850 et des Orres, lancée pour les
            vacances scolaires de février 2027. Vos voyageurs arrivent le jour de leur choix, à partir de 2&nbsp;nuits, et voient un prix tout compris.
          </p>
          <a href="#contact" className="mt-6 inline-flex h-12 items-center rounded-sm bg-brand-gradient px-6 font-semibold text-white">
            Proposer mon logement
          </a>
        </section>

        <section id="offre" aria-labelledby="offer-title" className="scroll-mt-24 bg-surface-2 py-12">
          <div className="gutter mx-auto max-w-[1120px]">
            <h2 id="offer-title" className="mb-6 text-title-l font-semibold max-md:text-title">
              Notre offre
            </h2>
            <ul className="grid gap-4 md:grid-cols-3">
              <OfferCard figure="10&nbsp;% HT" title="de commission, soit 12&nbsp;% TTC">
                Calculée sur le prix des nuits et le ménage des séjours réservés sur Nidou.
              </OfferCard>
              <OfferCard figure="0&nbsp;€" title="de frais pour vos voyageurs">
                Aucun frais de service côté voyageurs&nbsp;: ils voient un prix tout compris, taxe de séjour incluse.
              </OfferCard>
              <OfferCard figure="5&nbsp;% HT" title="au tarif fondateur">
                Pour les propriétaires qui ouvrent au moins quatre semaines d&apos;hiver avant le 15&nbsp;décembre&nbsp;2026, sur les séjours dont l&apos;arrivée a lieu au plus tard le 30&nbsp;avril&nbsp;2027.
              </OfferCard>
            </ul>
            <p className="mt-6 max-w-[820px] text-ink-muted" data-testid="offer-example">
              Exemple pour {formatPrice(EXAMPLE_BASE)} de nuits et de ménage&nbsp;: commission de {formatPrice(standard.commissionCents)} HT et{" "}
              {formatPrice(standard.commissionVatCents)} de TVA, vous recevez {formatPrice(standard.hostPayoutCents)}. Au tarif fondateur&nbsp;:{" "}
              {formatPrice(founding.commissionCents)} HT et {formatPrice(founding.commissionVatCents)} de TVA, vous recevez{" "}
              {formatPrice(founding.hostPayoutCents)}. La taxe de séjour, payée en plus par les voyageurs, est reversée à la commune.
            </p>
          </div>
        </section>

        <section id="services" aria-labelledby="services-title" className="gutter mx-auto max-w-[1120px] scroll-mt-24 py-12">
          <h2 id="services-title" className="mb-6 text-title-l font-semibold max-md:text-title">
            Ce que Nidou prend en charge
          </h2>
          <ul className="grid gap-8 md:grid-cols-3">
            {SERVICES.map(({ Icon, title, body }) => (
              <li key={title} className="flex gap-4">
                <Icon aria-hidden className="mt-0.5 size-7 shrink-0" strokeWidth={1.5} />
                <div>
                  <h3 className="text-body-l font-semibold">{title}</h3>
                  <p className="mt-1 text-ink-muted">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section id="contact" aria-labelledby="contact-title" className="gutter mx-auto max-w-[1120px] scroll-mt-24 border-t border-line pt-12">
          <h2 id="contact-title" className="text-title-l font-semibold max-md:text-title">
            Parlez-nous de votre logement
          </h2>
          <p className="mb-8 mt-2 text-ink-muted">Quelques informations suffisent pour que nous puissions vous recontacter.</p>
          <HostLeadForm places={places} />
        </section>
      </main>
      <Footer />
      <MobileBottomNav active="explore" />
    </>
  );
}

function OfferCard({ figure, title, children }: { figure: string; title: string; children: React.ReactNode }) {
  return (
    <li className="rounded-lg bg-white p-6 shadow-e1">
      <p className="text-display font-semibold">{figure}</p>
      <p className="mt-1 font-semibold">{title}</p>
      <p className="mt-3 text-ink-muted">{children}</p>
    </li>
  );
}
