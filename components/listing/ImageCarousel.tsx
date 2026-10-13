"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";
import { cn } from "@/lib/cn";

const MAX_DOTS = 5;

/**
 * Swipeable photo strip: native scroll-snap on touch, arrow buttons for mouse and keyboard.
 * Each slide links to `href` itself so the strip stays swipeable above the card's link overlay.
 * The arrows and dots sit inside the scroller (so keyboard users can reach a scrollable region) but are
 * positioned against the outer wrapper, so they don't scroll with the photos.
 */
export function ImageCarousel({
  photos,
  href,
  sizes,
  loadingHint,
}: {
  photos: string[];
  href: string;
  sizes: string;
  /** "eager": above the fold. "lcp": also fetched first (one per page). Default: lazy. */
  loadingHint?: "eager" | "lcp";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const go = (delta: number) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: delta * el.clientWidth, behavior: "smooth" });
  };

  return (
    <div className="group/photos relative z-[1] h-full w-full">
      <div
        ref={ref}
        data-testid="listing-image"
        onScroll={(e) => setIndex(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
        className="no-scrollbar flex h-full snap-x snap-mandatory overflow-x-auto"
      >
        {photos.map((src, i) => (
          <Link key={src} href={href} tabIndex={-1} aria-hidden className="relative h-full w-full shrink-0 snap-start">
            <Image
              src={src}
              alt=""
              fill
              sizes={sizes}
              loading={loadingHint && i === 0 ? "eager" : "lazy"}
              fetchPriority={loadingHint === "lcp" && i === 0 ? "high" : undefined}
              className="object-cover"
            />
          </Link>
        ))}
        {photos.length > 1 && (
          <>
            <Arrow side="left" hidden={index === 0} onClick={() => go(-1)} />
            <Arrow side="right" hidden={index >= photos.length - 1} onClick={() => go(1)} />
            <span aria-hidden className="pointer-events-none absolute bottom-2.5 left-1/2 z-[2] flex -translate-x-1/2 gap-1">
              {photos.slice(0, MAX_DOTS).map((src, i) => (
                <span key={src} className={cn("size-1.5 rounded-full bg-white transition-opacity", i === Math.min(index, MAX_DOTS - 1) ? "opacity-100" : "opacity-60")} />
              ))}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function Arrow({ side, hidden, onClick }: { side: "left" | "right"; hidden: boolean; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={side === "left" ? "Photo précédente" : "Photo suivante"}
      onClick={onClick}
      className={cn(
        // Mouse: revealed on hover (md+). Keyboard: revealed on focus, at every size.
        "absolute top-1/2 z-[2] grid size-8 -translate-y-1/2 place-items-center rounded-full bg-white/90 opacity-0 shadow-e1 transition-opacity hover:bg-white focus-visible:opacity-100 md:group-hover/photos:opacity-100",
        side === "left" ? "left-3" : "right-3",
        hidden && "hidden",
      )}
    >
      <Icon className="size-4" strokeWidth={2.5} />
    </button>
  );
}
