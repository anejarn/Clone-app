"use client";

import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { IconButton } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

/** Items per view: listing cards 7 / 6 / 5 / ~2.2, small tiles (destinations, services) 10 / 8 / 6 / ~2.8, as on airbnb.fr. */
const TRACKS = {
  cards: "auto-cols-[46%] md:auto-cols-[calc((100%-48px)/5)] lg:auto-cols-[calc((100%-60px)/6)] xl:auto-cols-[calc((100%-72px)/7)]",
  tiles: "auto-cols-[36%] md:auto-cols-[calc((100%-60px)/6)] lg:auto-cols-[calc((100%-84px)/8)] xl:auto-cols-[calc((100%-108px)/10)]",
};

/** Section heading + horizontally snapping track with page-by-page arrows. */
export function CarouselSection({
  title,
  href,
  density = "cards",
  children,
}: {
  title: string;
  href?: string;
  density?: keyof typeof TRACKS;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  }, []);

  useEffect(() => {
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [update]);

  const page = (dir: 1 | -1) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth, behavior: "smooth" });
  };

  return (
    <section aria-label={title} aria-roledescription="carousel" className="mb-10">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-title font-semibold tracking-[-0.2px] max-md:text-title-s">
          {href ? (
            <Link href={href} className="hover:underline">
              {title}
            </Link>
          ) : (
            title
          )}
        </h2>
        <div className="flex shrink-0 gap-2">
          <IconButton size="sm" aria-label="Précédent" disabled={edges.start} onClick={() => page(-1)} className="max-md:hidden">
            <ChevronLeft className="size-3.5" strokeWidth={3} />
          </IconButton>
          <IconButton size="sm" aria-label="Suivant" disabled={edges.end} onClick={() => page(1)} className="max-md:hidden">
            <ChevronRight className="size-3.5" strokeWidth={3} />
          </IconButton>
          {href && (
            <Link href={href} aria-label={`Tout afficher : ${title}`} className="grid size-8 place-items-center rounded-full bg-surface-3 md:hidden">
              <ArrowRight className="size-4" />
            </Link>
          )}
        </div>
      </div>
      <div
        ref={ref}
        onScroll={update}
        data-testid="content-scroller"
        className={cn("no-scrollbar grid snap-x snap-mandatory grid-flow-col gap-3 overflow-x-auto [&>*]:snap-start", TRACKS[density])}
      >
        {children}
      </div>
    </section>
  );
}
