"use client";

import { Search } from "lucide-react";
import { cn } from "@/lib/cn";
import type { SearchDraft } from "@/lib/search/useSearchDraft";
import type { Segment } from "./BigSearch";
import { datesLabel, guestsLabel } from "./summary";

export function CompactSearch({ draft, onOpen }: { draft: SearchDraft; onOpen: (s: Segment) => void }) {
  const guests = guestsLabel(draft.guests);
  // [segment, label, muted]
  const items: [Segment, string, boolean][] = [
    ["where", draft.where || "N'importe où", false],
    ["when", datesLabel(draft.range) ?? "Une semaine", false],
    ["who", guests ?? "Ajouter des voyageurs", !guests],
  ];
  return (
    <div
      data-testid="little-search"
      className="flex h-12 items-center rounded-pill border border-line bg-white pl-2 shadow-e1 transition-shadow hover:shadow-popover"
    >
      {items.map(([seg, label, muted], i) => (
        <span key={seg} className="flex items-center">
          {i > 0 && <span aria-hidden className="h-6 w-px bg-line" />}
          <button
            type="button"
            onClick={() => onOpen(seg)}
            className={cn("max-w-[180px] truncate px-4 font-medium", muted && "font-normal text-ink-muted")}
          >
            {label}
          </button>
        </span>
      ))}
      <button
        type="button"
        aria-label="Rechercher"
        onClick={() => onOpen("where")}
        className="mr-2 grid size-8 place-items-center rounded-full bg-brand-strong text-white"
      >
        <Search className="size-3.5" strokeWidth={3} />
      </button>
    </div>
  );
}
