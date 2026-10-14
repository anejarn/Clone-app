"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Search, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import type { SearchDraft } from "@/lib/search/useSearchDraft";
import { useSuggestions } from "@/lib/search/useSuggestions";
import type { Segment } from "./BigSearch";
import { LazyCalendar } from "./LazyCalendar";
import { DestinationList, useDestinationCombobox } from "./DestinationList";
import { GuestsPicker } from "./GuestsPicker";
import { datesLabel, guestsLabel } from "./summary";

export function MobileSearch({ draft, hasQuery }: { draft: SearchDraft; hasQuery: boolean }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Segment>("where");
  const suggestions = useSuggestions(draft.where, open && step === "where");
  // Escape closes the suggestion list (not the sheet); typing or ArrowDown shows it again.
  const [listClosed, setListClosed] = useState(false);
  const whereRef = useRef<HTMLInputElement>(null);
  const combobox = useDestinationCombobox({
    places: suggestions.places,
    query: draft.where,
    open: step === "where" && !listClosed,
    onOpen: () => setListClosed(false),
    onClose: () => setListClosed(true),
    onPick: (p) => {
      draft.choosePlace(p);
      setStep("when");
    },
  });
  const dates = datesLabel(draft.range);
  const guests = guestsLabel(draft.guests);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        // Each opening starts with the suggestions shown, whatever Escape did last time.
        if (o) setListClosed(false);
      }}
    >
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="flex h-14 w-full items-center justify-center gap-3 rounded-pill border border-line-soft bg-white px-6 shadow-e3"
        >
          <Search className="size-4 shrink-0" strokeWidth={3} />
          {hasQuery ? (
            <span className="min-w-0 text-left">
              <span className="block truncate font-semibold">{draft.where || "Partout"}</span>
              <span className="block truncate text-micro text-ink-muted">
                {[dates ?? "Dates flexibles", guests ?? "Ajouter des voyageurs"].join(" · ")}
              </span>
            </span>
          ) : (
            <span className="font-semibold">Commencer ma recherche</span>
          )}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Content
          className="fixed inset-0 z-50 flex animate-pop-in flex-col bg-surface-2"
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => {
            // Escape in the destination field closes its open list first, then the sheet.
            if (combobox.expanded && document.activeElement === whereRef.current) {
              e.preventDefault();
              setListClosed(true);
            }
          }}
        >
          <div className="flex items-center px-6 pt-4">
            <Dialog.Close className="grid size-8 place-items-center rounded-full border border-line bg-white" aria-label="Fermer">
              <X className="size-4" />
            </Dialog.Close>
            <Dialog.Title className="flex-1 pr-8 text-center font-semibold">Logements</Dialog.Title>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto px-3 py-4">
            <Step
              title="Où ?"
              summaryLabel="Destination"
              summary={draft.where || "Partout"}
              open={step === "where"}
              onOpen={() => {
                setListClosed(false);
                setStep("where");
              }}
            >
              <input
                ref={whereRef}
                autoFocus
                {...combobox.inputProps}
                value={draft.where}
                onChange={(e) => {
                  draft.setWhere(e.target.value);
                  setListClosed(false);
                }}
                aria-label="Destination"
                placeholder="Rechercher une destination"
                autoComplete="off"
                className="mb-4 h-14 w-full rounded-md border border-ink-faint px-4 text-body outline-none focus:border-ink"
              />
              {!listClosed && (
                <div className="-mx-4">
                  <DestinationList places={suggestions.places} loading={suggestions.loading} query={draft.where} {...combobox.listProps} />
                </div>
              )}
            </Step>
            <Step title="Quand ?" summaryLabel="Quand" summary={dates ?? "Ajouter des dates"} open={step === "when"} onOpen={() => setStep("when")} focusTitle>
              <div className="flex justify-center">
                <LazyCalendar value={draft.range} onChange={draft.setRange} months={1} />
              </div>
            </Step>
            <Step title="Qui ?" summaryLabel="Voyageurs" summary={guests ?? "Ajouter des voyageurs"} open={step === "who"} onOpen={() => setStep("who")} focusTitle>
              <GuestsPicker value={draft.guests} onChange={draft.setGuests} />
            </Step>
          </div>
          <div className="flex items-center justify-between border-t border-line bg-white px-6 py-4">
            <Button variant="link" onClick={draft.clear}>
              Tout effacer
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setOpen(false);
                draft.submit(suggestions.places[0]);
              }}
            >
              <Search className="size-4" strokeWidth={3} />
              Rechercher
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Step({
  title,
  summaryLabel,
  summary,
  open,
  onOpen,
  focusTitle,
  children,
}: {
  title: string;
  summaryLabel: string;
  summary: string;
  open: boolean;
  onOpen: () => void;
  /** Move focus to the title when the step opens (picking a destination or tapping the summary unmounts the focused control). */
  focusTitle?: boolean;
  children: ReactNode;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (open && focusTitle) titleRef.current?.focus();
  }, [open, focusTitle]);
  return (
    <section className={cn("rounded-[24px] bg-white shadow-e1", open ? "p-6" : "")}>
      {open ? (
        <>
          <h2 ref={titleRef} tabIndex={-1} className="mb-4 text-title-l font-semibold outline-none">
            {title}
          </h2>
          {children}
        </>
      ) : (
        <button type="button" onClick={onOpen} className="flex w-full items-center justify-between px-6 py-5 text-body">
          <span className="text-ink-muted">{summaryLabel}</span>
          <span className="font-semibold">{summary}</span>
        </button>
      )}
    </section>
  );
}
