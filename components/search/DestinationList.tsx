"use client";

import { MapPin } from "lucide-react";
import type { Place } from "@/lib/types";

export function DestinationList({
  places,
  query,
  loading,
  onPick,
}: {
  places: Place[];
  query: string;
  loading: boolean;
  onPick: (p: Place) => void;
}) {
  return (
    <div aria-busy={loading}>
      {!query && <p className="px-4 pb-2 text-micro font-medium">Suggestions de destinations</p>}
      {!loading && places.length === 0 && (
        <p className="px-4 py-3 text-ink-muted">Aucune destination trouvée. Lancez la recherche pour « {query} ».</p>
      )}
      {loading && places.length === 0 && (
        <ul aria-hidden className="space-y-2 px-4">
          {Array.from({ length: 4 }, (_, i) => (
            <li key={i} className="flex items-center gap-4 py-2">
              <span className="size-12 animate-pulse rounded-md bg-line-soft" />
              <span className="h-4 w-40 animate-pulse rounded bg-line-soft" />
            </li>
          ))}
        </ul>
      )}
      <ul role="listbox" aria-label="Destinations">
        {places.map((p) => (
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
