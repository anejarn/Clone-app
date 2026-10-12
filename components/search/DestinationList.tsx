"use client";

import { MapPin } from "lucide-react";
import { matchPlaces } from "@/lib/search/useSearchDraft";
import type { Place } from "@/lib/types";

export function DestinationList({ places, query, onPick }: { places: Place[]; query: string; onPick: (p: Place) => void }) {
  const matches = matchPlaces(places, query).slice(0, query ? 8 : 6);
  return (
    <div>
      {!query && <p className="px-4 pb-2 text-micro font-medium">Suggestions de destinations</p>}
      {matches.length === 0 && <p className="px-4 py-3 text-ink-muted">Aucune destination trouvée. Lancez la recherche pour « {query} ».</p>}
      <ul role="listbox" aria-label="Destinations">
        {matches.map((p) => (
          <li key={p.slug} role="option" aria-selected={false}>
            <button
              type="button"
              onClick={() => onPick(p)}
              className="flex w-full items-center gap-4 rounded-md px-4 py-2 text-left hover:bg-surface-2"
            >
              <span className="grid size-12 shrink-0 place-items-center rounded-md bg-surface-3">
                <MapPin className="size-5" strokeWidth={1.75} />
              </span>
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {p.name}, {p.country}
                </span>
                <span className="block truncate text-ink-muted">{p.tagline}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
