import { Globe } from "lucide-react";
import Link from "next/link";
import { RESORTS } from "@/lib/content";

/** Only links to pages that exist. (#aide, used by the user menu and cookie banner, still lands here.) */
const COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Propriétaires",
    links: [
      { label: "Mettez votre logement sur Nidou", href: "/devenir-hote" },
      { label: "Commission et tarif fondateur", href: "/devenir-hote#offre" },
      { label: "Ce que Nidou prend en charge", href: "/devenir-hote#services" },
    ],
  },
  {
    title: "Stations",
    links: RESORTS.map((r) => ({ label: r.name, href: `/s/${r.slug}/homes` })),
  },
];

export function Footer() {
  return (
    <footer id="aide" className="bg-surface-2 pb-24 md:pb-8">
      <div className="gutter mx-auto max-w-[1760px]">
        <h2 className="sr-only">Pied de page du site</h2>
        <div className="grid gap-6 border-t border-line py-10 md:grid-cols-2">
          {COLUMNS.map((col) => (
            <section key={col.title} className="max-md:border-b max-md:border-line max-md:pb-6 max-md:last:border-0">
              <h3 className="mb-4 font-semibold">{col.title}</h3>
              <ul className="space-y-4">
                {col.links.map((l) => (
                  <li key={l.label}>
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
          <p>© {COPYRIGHT_YEAR} Nidou</p>
          <div className="flex items-center gap-6 font-medium">
            <button type="button" className="flex items-center gap-2 hover:underline">
              <Globe className="size-4" />
              Français (FR)
            </button>
            <button type="button" className="hover:underline">
              € EUR
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}

// Static on purpose: reading the clock here would make every page dynamic.
const COPYRIGHT_YEAR = 2026;
