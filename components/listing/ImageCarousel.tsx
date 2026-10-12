"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";
import { cn } from "@/lib/cn";

const MAX_DOTS = 5;

/** Swipeable photo strip: native scroll-snap on touch, arrow buttons on hover (md+). */
/** Each slide links to `href` itself so the strip stays swipeable above the card's link overlay. */
export function ImageCarousel({ photos, href, sizes, priority }: { photos: string[]; href: string; sizes: string; priority?: boolean }) {
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
            <Image src={src} alt="" fill sizes={sizes} priority={priority && i === 0} className="object-cover" />
          </Link>
        ))}
      </div>
      {photos.length > 1 && (
        <>
          <Arrow side="left" hidden={index === 0} onClick={() => go(-1)} />
          <Arrow side="right" hidden={index >= photos.length - 1} onClick={() => go(1)} />
          <div aria-hidden className="pointer-events-none absolute bottom-2.5 left-1/2 z-[2] flex -translate-x-1/2 gap-1">
            {photos.slice(0, MAX_DOTS).map((src, i) => (
              <span key={src} className={cn("size-1.5 rounded-full bg-white transition-opacity", i === Math.min(index, MAX_DOTS - 1) ? "opacity-100" : "opacity-60")} />
            ))}
          </div>
        </>
      )}
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
        "absolute top-1/2 z-[2] hidden size-8 -translate-y-1/2 place-items-center rounded-full bg-white/90 opacity-0 shadow-e1 transition-opacity hover:bg-white group-hover/photos:opacity-100 md:grid",
        side === "left" ? "left-3" : "right-3",
        hidden && "md:hidden",
      )}
    >
      <Icon className="size-4" strokeWidth={2.5} />
    </button>
  );
}
