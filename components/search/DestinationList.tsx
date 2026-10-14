"use client";

import { MapPin } from "lucide-react";
import type { KeyboardEvent } from "react";
import type { Place } from "@/lib/types";

/** Up/Down move between suggestions (the input's ArrowDown lands on the first one). */
export function moveSuggestionFocus(e: KeyboardEvent<HTMLElement>, list: HTMLElement | null) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const buttons = Array.from(list?.querySelectorAll<HTMLButtonElement>("button[data-suggestion]") ?? []);
  if (buttons.length === 0) return;
  e.preventDefault();
  const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next = e.key === "ArrowDown" ? Math.min(i + 1, buttons.length - 1) : i - 1;
  if (next >= 0) buttons[next].focus();
  else (list?.closest("form, [role=dialog]")?.querySelector<HTMLInputElement>("input") ?? null)?.focus();
}

export function DestinationList({
  places,
  query,
  loading,
  onPick,
  listRef,
}: {
  places: Place[];
  query: string;
  loading: boolean;
  onPick: (p: Place) => void;
  listRef?: React.Ref<HTMLUListElement>;
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
      <ul ref={listRef} aria-label="Destinations suggérées" onKeyDown={(e) => moveSuggestionFocus(e, e.currentTarget)}>
        {places.map((p) => (
          <li key={p.slug}>
            <button
              type="button"
              data-suggestion
              onClick={() => onPick(p)}
              className="flex w-full items-center gap-4 rounded-md px-4 py-2 text-left outline-none hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ink"
            >
              <span className="grid size-12 shrink-0 place-items-center rounded-md bg-surface-3">
                <MapPin aria-hidden className="size-5" strokeWidth={1.75} />
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
