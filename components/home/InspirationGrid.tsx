import Link from "next/link";
import type { InspirationGroup } from "@/lib/types";

/** "Trouver un logement par station": a column of searches per resort. */
export function InspirationGrid({ groups }: { groups: InspirationGroup[] }) {
  return (
    <section aria-labelledby="by-resort-title" className="bg-surface-2 pb-6 pt-12">
      <div className="gutter mx-auto max-w-[1760px]">
        <h2 id="by-resort-title" className="mb-6 text-title font-semibold tracking-[-0.2px]">
          Trouver un logement par station
        </h2>
        <div className="grid gap-8 md:grid-cols-2">
          {groups.map((g) => (
            <nav key={g.label} aria-label={g.label}>
              <h3 className="mb-4 border-b border-line pb-2.5 font-semibold">{g.label}</h3>
              <ul className="grid grid-cols-2 gap-x-4 gap-y-4 lg:grid-cols-3">
                {g.links.map((l) => (
                  <li key={l.href} className="min-w-0">
                    <Link href={l.href} className="block truncate font-medium hover:underline">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </div>
    </section>
  );
}
