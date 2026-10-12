"use client";

import { Search } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { SearchDraft } from "@/lib/search/useSearchDraft";
import type { Place } from "@/lib/types";
import { DateRangeCalendar } from "./DateRangeCalendar";
import { DestinationList } from "./DestinationList";
import { GuestsPicker } from "./GuestsPicker";
import { datesLabel, guestsLabel } from "./summary";

export type Segment = "where" | "when" | "who";

export function BigSearch({
  draft,
  places,
  active,
  onActiveChange,
}: {
  draft: SearchDraft;
  places: Place[];
  active: Segment | null;
  onActiveChange: (s: Segment | null) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const whereRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!active) return;
    const onDown = (e: PointerEvent) => {
      if (!formRef.current?.contains(e.target as Node)) onActiveChange(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onActiveChange(null);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [active, onActiveChange]);

  useEffect(() => {
    if (active === "where") whereRef.current?.focus();
  }, [active]);

  const dates = datesLabel(draft.range);
  const guests = guestsLabel(draft.guests);

  return (
    <form
      ref={formRef}
      role="search"
      data-testid="big-search"
      onSubmit={(e) => {
        e.preventDefault();
        onActiveChange(null);
        draft.submit();
      }}
      className={cn(
        "relative flex h-[66px] w-full max-w-[850px] items-center rounded-pill border border-line shadow-e3 transition-colors duration-200",
        active ? "bg-line-soft" : "bg-white",
      )}
    >
      <SegmentShell id="where" active={active} className="flex-[1.15]" onActivate={() => onActiveChange("where")}>
        <label htmlFor="search-where" className="block text-micro font-medium">
          Destination
        </label>
        <input
          ref={whereRef}
          id="search-where"
          data-testid="structured-search-input-field-query"
          value={draft.where}
          onChange={(e) => draft.setWhere(e.target.value)}
          onFocus={() => onActiveChange("where")}
          placeholder="Rechercher une destination"
          autoComplete="off"
          className="w-full truncate bg-transparent text-body text-ink outline-none placeholder:text-ink-muted"
        />
      </SegmentShell>
      <SegmentShell id="when" active={active} onActivate={() => onActiveChange("when")} asButton>
        <span className="block text-micro font-medium">Dates</span>
        <span className={cn("block truncate", dates ? "text-ink" : "text-ink-muted")}>{dates ?? "Quand ?"}</span>
      </SegmentShell>
      {/* Right padding keeps the label clear of the search button, which widens while a segment is open. */}
      <SegmentShell id="who" active={active} className={cn("flex-[1.35]", active ? "pr-[164px]" : "pr-[72px]")} onActivate={() => onActiveChange("who")} asButton>
        <span className="block text-micro font-medium">Voyageurs</span>
        <span className={cn("block truncate", guests ? "text-ink" : "text-ink-muted")}>{guests ?? "Ajouter des voyageurs"}</span>
      </SegmentShell>

      <button
        type="submit"
        data-testid="structured-search-input-search-button"
        aria-label="Rechercher"
        className={cn(
          "absolute right-[9px] z-10 flex h-12 items-center justify-center gap-2 rounded-pill bg-brand-strong font-semibold text-white transition-all duration-300 ease-standard hover:bg-brand-gradient",
          active ? "px-4" : "w-12",
        )}
      >
        <Search className="size-4" strokeWidth={3} />
        {active && <span className="text-body-l">Rechercher</span>}
      </button>

      {active && (
        <div
          className={cn(
            "absolute top-[calc(100%+12px)] z-20 animate-pop-in rounded-[32px] bg-white shadow-modal",
            active === "where" && "left-0 w-[425px] py-6",
            active === "when" && "inset-x-0 flex justify-center p-8",
            active === "who" && "right-0 w-[400px] px-8 py-6",
          )}
        >
          {active === "where" && (
            <DestinationList
              places={places}
              query={draft.where}
              onPick={(p) => {
                draft.choosePlace(p);
                onActiveChange("when");
              }}
            />
          )}
          {active === "when" && (
            <div>
              <DateRangeCalendar value={draft.range} onChange={draft.setRange} />
              <div className="mt-4 flex justify-end">
                <button type="button" className="font-semibold underline" onClick={() => draft.setRange(undefined)}>
                  Effacer les dates
                </button>
              </div>
            </div>
          )}
          {active === "who" && <GuestsPicker value={draft.guests} onChange={draft.setGuests} />}
        </div>
      )}
    </form>
  );
}

function SegmentShell({
  id,
  active,
  onActivate,
  asButton,
  className,
  children,
}: {
  id: Segment;
  active: Segment | null;
  onActivate: () => void;
  asButton?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const isActive = active === id;
  const cls = cn(
    "search-seg relative flex h-full min-w-0 flex-1 cursor-pointer flex-col justify-center rounded-pill px-8 text-left transition-colors duration-200",
    isActive ? "bg-white shadow-popover" : active ? "hover:bg-line" : "hover:bg-line-soft",
    className,
  );
  return asButton ? (
    <button type="button" data-active={isActive || undefined} aria-expanded={isActive} onClick={onActivate} className={cls}>
      {children}
    </button>
  ) : (
    <div data-active={isActive || undefined} onClick={onActivate} className={cls}>
      {children}
    </div>
  );
}
