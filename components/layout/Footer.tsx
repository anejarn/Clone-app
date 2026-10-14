import { Globe } from "lucide-react";
import Link from "next/link";

/** Only links to pages that exist (tests/e2e/help.spec.ts opens every one). */
const COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Assistance",
    links: [
      { label: "Rechercher un logement", href: "/aide#rechercher" },
      { label: "Voyages et annulation", href: "/aide#voyages" },
      { label: "Favoris sans compte", href: "/aide#favoris" },
      { label: "Votre compte", href: "/aide#compte" },
      { label: "Cookies", href: "/aide#cookies" },
    ],
  },
  {
    title: "Voyager",
    links: [
      { label: "Logements", href: "/homes" },
      { label: "Expériences", href: "/experiences" },
      { label: "Services", href: "/services" },
      { label: "Favoris", href: "/wishlists" },
      { label: "Voyages", href: "/trips" },
    ],
  },
  {
    title: "Sigma",
    links: [
      { label: "Centre d'aide", href: "/aide" },
      { label: "Connexion ou inscription", href: "/login" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="bg-surface-2 pb-24 md:pb-8">
      <div className="gutter mx-auto max-w-[1760px]">
        <h2 className="sr-only">Pied de page du site</h2>
        <div className="grid gap-6 border-t border-line py-10 md:grid-cols-3">
          {COLUMNS.map((col) => (
            <section key={col.title} className="max-md:border-b max-md:border-line max-md:pb-6 max-md:last:border-0">
              <h3 className="mb-4 font-semibold">{col.title}</h3>
              <ul className="space-y-4">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="hover:underline">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="flex flex-col-reverse gap-4 border-t border-line pt-6 lg:flex-row lg:items-center lg:justify-between">
          <p>© {COPYRIGHT_YEAR} Sigma</p>
          {/* French and euros only: plain text, not pickers that would do nothing. */}
          <p className="flex items-center gap-6 font-medium" data-testid="footer-locale">
            <span className="flex items-center gap-2">
              <Globe aria-hidden className="size-4" />
              Français (FR)
            </span>
            <span>€ EUR</span>
          </p>
        </div>
      </div>
    </footer>
  );
}

// Static on purpose: reading the clock here would make every page dynamic.
const COPYRIGHT_YEAR = 2026;
