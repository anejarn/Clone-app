import { Star } from "lucide-react";
import Link from "next/link";
import type { CardData } from "@/lib/server/cards";
import { formatRating } from "@/lib/format";
import { cn } from "@/lib/cn";
import { ImageCarousel } from "./ImageCarousel";
import { SaveButton } from "./SaveButton";

const Sep = () => (
  <span aria-hidden className="mx-1 text-sep">
    ·
  </span>
);

export function ListingCard({
  card,
  variant = "carousel",
  loadingHint,
}: {
  card: CardData;
  /** Search grids use larger type and a bold price. */
  variant?: "carousel" | "grid";
  /** See ImageCarousel. */
  loadingHint?: "eager" | "lcp";
}) {
  const titleId = `title_${card.id}`;
  const grid = variant === "grid";
  return (
    <div role="group" aria-labelledby={titleId} data-testid="card-container" className="relative">
      <Link href={card.href} aria-labelledby={titleId} className="absolute inset-0 z-[1] rounded-lg" />
      <div className={cn("relative overflow-hidden rounded-lg bg-line-soft", grid ? "aspect-[20/19]" : "aspect-[1/0.95]")}>
        <ImageCarousel
          photos={card.photos}
          href={card.href}
          loadingHint={loadingHint}
          sizes={grid ? "(max-width: 743px) calc(100vw - 48px), (max-width: 1127px) 50vw, 25vw" : "(max-width: 743px) 46vw, (max-width: 1127px) 20vw, 200px"}
        />
        {card.badge && (
          <span className="pointer-events-none absolute left-3 top-3 z-[2] max-w-[calc(100%-64px)] rounded-[14px] bg-white px-2.5 py-1 text-micro font-semibold leading-[14px] shadow-e1">
            {card.badge}
          </span>
        )}
        <SaveButton id={card.id} label={card.title} />
      </div>
      <div className={cn("mt-2", grid ? "text-body" : "text-micro")}>
        <h3 id={titleId} data-testid="listing-card-title" className={cn("truncate font-medium", grid ? "text-body" : "text-caption")}>
          {card.title}
        </h3>
        {(card.subtitle || card.hostKind) && (
          <p className="truncate text-ink-muted">
            {card.subtitle}
            {card.subtitle && card.hostKind && <Sep />}
            {card.hostKind}
          </p>
        )}
        <p className={cn("truncate", grid ? "mt-1" : "text-ink-muted")}>
          <span className={cn(grid && "font-semibold")}>{card.price}</span> {card.priceSuffix}
          <Sep />
          <span className="inline-flex items-center gap-0.5">
            <Star aria-hidden className="size-2.5 fill-current" />
            {card.rating !== null ? (
              <>
                <span className="sr-only">Évaluation moyenne : </span>
                {formatRating(card.rating)}
              </>
            ) : (
              "Nouveau"
            )}
          </span>
        </p>
      </div>
    </div>
  );
}
