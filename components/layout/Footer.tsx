import { Globe } from "lucide-react";

const COLUMNS: { title: string; links: string[] }[] = [
  {
    title: "Assistance",
    links: ["Centre d'aide", "Assistance sécurité", "Options d'annulation", "Assistance handicap", "Lutte contre la discrimination", "J'ai un problème de voisinage"],
  },
  {
    title: "Accueil de voyageurs",
    links: ["Mettez votre logement sur Nidou", "Proposez votre expérience sur Nidou", "Proposez votre service sur Nidou", "Ressources pour les hôtes", "Forum de la communauté", "Trouver un co-hôte"],
  },
  { title: "Nidou", links: ["Nouveautés", "Newsroom", "Carrières", "Cartes cadeaux"] },
];

const LEGAL = ["Confidentialité", "Conditions générales", "Plan du site", "Infos sur l'entreprise"];

export function Footer() {
  return (
    <footer id="aide" className="bg-surface-2 pb-24 md:pb-8">
      <div className="gutter mx-auto max-w-[1760px]">
        <h2 className="sr-only">Pied de page du site</h2>
        <div className="grid gap-6 border-t border-line py-10 md:grid-cols-3">
          {COLUMNS.map((col) => (
            <section key={col.title} className="max-md:border-b max-md:border-line max-md:pb-6 max-md:last:border-0">
              <h3 className="mb-4 font-semibold">{col.title}</h3>
              <ul className="space-y-4">
                {col.links.map((l) => (
                  <li key={l}>
                    <a href="#aide" className="hover:underline">
                      {l}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="flex flex-col-reverse gap-4 border-t border-line pt-6 lg:flex-row lg:items-center lg:justify-between">
          <p className="flex flex-wrap gap-x-2">
            <span>© {COPYRIGHT_YEAR} Nidou, Inc.</span>
            {LEGAL.map((l) => (
              <span key={l} className="before:mr-2 before:content-['·']">
                <a href="#aide" className="hover:underline">
                  {l}
                </a>
              </span>
            ))}
          </p>
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
