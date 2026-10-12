"use client";

import { useCallback, useEffect, useState } from "react";
import { BigSearch, type Segment } from "@/components/search/BigSearch";
import { CompactSearch } from "@/components/search/CompactSearch";
import { MobileSearch } from "@/components/search/MobileSearch";
import { cn } from "@/lib/cn";
import { useSearchDraft, type SearchInitial } from "@/lib/search/useSearchDraft";
import type { Place } from "@/lib/types";
import { CategoryTabs } from "./CategoryTabs";
import { Logo } from "./Logo";
import { UserMenu } from "./UserMenu";

/**
 * Fixed site header. "home" starts expanded (tabs + BigSearch) and collapses to the
 * compact pill after scrolling; "compact" pages start collapsed. Either way the pill
 * re-expands the full search over a scrim. A spacer reserves the starting height,
 * so collapsing never shifts the page.
 */
export function Header({ variant, places, initial }: { variant: "home" | "compact"; places: Place[]; initial?: SearchInitial }) {
  const draft = useSearchDraft(places, initial);
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<Segment | null>(null);

  useEffect(() => {
    if (variant !== "home") return;
    const onScroll = () => setScrolled(window.scrollY > 64);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [variant]);

  // Scrolling while forced open collapses back, like the original.
  useEffect(() => {
    if (!open) return;
    const close = () => {
      setOpen(false);
      setActive(null);
    };
    window.addEventListener("scroll", close, { passive: true, once: true });
    return () => window.removeEventListener("scroll", close);
  }, [open]);

  const expanded = (variant === "home" && !scrolled) || open;
  const onActiveChange = useCallback(
    (s: Segment | null) => {
      setActive(s);
      if (s === null && open) setOpen(false);
    },
    [open],
  );

  return (
    <>
      <header
        data-testid="header"
        className={cn(
          "fixed inset-x-0 top-0 z-40 border-b border-line-soft",
          expanded ? "bg-gradient-to-b from-white from-40% to-surface-2" : "bg-white",
          "max-md:bg-white",
        )}
      >
        {/* Desktop */}
        <div className="gutter hidden md:block">
          <div className={cn("grid grid-cols-[1fr_auto_1fr] items-center", expanded ? "h-24" : "h-20")}>
            <Logo />
            <div className="flex h-full items-center justify-center">
              {expanded ? (
                <CategoryTabs variant="bar" />
              ) : (
                <CompactSearch
                  draft={draft}
                  onOpen={(s) => {
                    setOpen(true);
                    setActive(s);
                  }}
                />
              )}
            </div>
            <UserMenu />
          </div>
          {expanded && (
            <div className="flex justify-center pb-8 pt-1.5">
              <BigSearch draft={draft} places={places} active={active} onActiveChange={onActiveChange} />
            </div>
          )}
        </div>

        {/* Mobile */}
        <div className="gutter md:hidden">
          <div className="pb-3 pt-3.5">
            <MobileSearch draft={draft} places={places} hasQuery={!!initial} />
          </div>
          {variant === "home" && <CategoryTabs variant="chips" />}
        </div>
      </header>

      {open && (
        <div
          aria-hidden
          className="fixed inset-0 z-30 bg-black/25"
          onClick={() => {
            setOpen(false);
            setActive(null);
          }}
        />
      )}
      <div aria-hidden className={variant === "home" ? "h-[135px] md:h-[201px]" : "h-[83px] md:h-[81px]"} />
    </>
  );
}
