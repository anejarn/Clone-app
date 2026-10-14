"use client";

import { MapPin } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import type { Place } from "@/lib/types";

/**
 * ARIA 1.2 combobox for the destination field (list autocomplete): focus stays in the input, ArrowDown/ArrowUp
 * move a highlight through the suggestions (wrapping at both ends) and expose it with aria-activedescendant,
 * Enter picks the highlighted suggestion (with none highlighted, Enter keeps its default: the search bar
 * submits), Escape closes the list. `open` says whether the list is shown; `onOpen`/`onClose` change that.
 */
export function useDestinationCombobox({
  places,
  query,
  open,
  onOpen,
  onClose,
  onPick,
}: {
  places: Place[];
  query: string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onPick: (p: Place) => void;
}) {
  const listboxId = `${useId()}-destinations`;
  const optionId = (i: number) => `${listboxId}-${i}`;
  // The highlight belongs to one query: typing resets it without an effect.
  const [highlight, setHighlight] = useState({ query, index: -1 });
  const expanded = open && places.length > 0;
  const active = expanded && highlight.query === query && highlight.index < places.length ? highlight.index : -1;

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!expanded) return onOpen();
      const n = places.length;
      const next = e.key === "ArrowDown" ? (active + 1) % n : active <= 0 ? n - 1 : active - 1;
      setHighlight({ query, index: next });
      document.getElementById(optionId(next))?.scrollIntoView?.({ block: "nearest" });
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      onPick(places[active]);
    } else if (e.key === "Escape" && expanded) {
      e.preventDefault();
      onClose();
    }
  }

  return {
    expanded,
    inputProps: {
      role: "combobox" as const,
      "aria-autocomplete": "list" as const,
      "aria-expanded": expanded,
      "aria-controls": listboxId,
      "aria-activedescendant": active >= 0 ? optionId(active) : undefined,
      onKeyDown,
    },
    listProps: { listboxId, optionId, activeIndex: active, onPick },
  };
}

export function DestinationList({
  places,
  query,
  loading,
  listboxId,
  optionId,
  activeIndex,
  onPick,
}: {
  places: Place[];
  query: string;
  loading: boolean;
  listboxId: string;
  optionId: (i: number) => string;
  activeIndex: number;
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
      {/* Rendered only with options: the input's aria-controls may name it while the list is collapsed. */}
      {places.length > 0 && (
        <ul id={listboxId} role="listbox" aria-label="Destinations suggérées">
          {places.map((p, i) => (
            // Options hold text only (no nested buttons): the input keeps focus, keys move aria-activedescendant.
            <li
              key={p.slug}
              id={optionId(i)}
              role="option"
              aria-selected={i === activeIndex}
              // Keep focus in the input on click, as with the keyboard.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(p)}
              className={cn("mx-2 flex cursor-pointer items-center gap-4 rounded-md px-2 py-2 hover:bg-surface-2", i === activeIndex && "bg-surface-2 ring-2 ring-inset ring-ink")}
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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
