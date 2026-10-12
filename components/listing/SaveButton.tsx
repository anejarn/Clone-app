"use client";

import { cn } from "@/lib/cn";
import { useWishlist } from "@/lib/wishlist";

export function SaveButton({ id, label }: { id: string; label: string }) {
  const { has, toggle } = useWishlist();
  const saved = has(id);
  return (
    <button
      type="button"
      data-testid="listing-card-save-button"
      aria-label={saved ? `Retirer ${label} des favoris` : `Enregistrer ${label} dans les favoris`}
      aria-pressed={saved}
      onClick={() => toggle(id)}
      // 44px hit area around a 28px glyph.
      className="absolute right-1.5 top-1.5 z-[2] grid size-11 place-items-center transition-transform active:scale-90"
    >
      <svg viewBox="0 0 32 32" aria-hidden className="size-7">
        <path
          d="M16 28C7 21 3 16.5 3 11.5A6.5 6.5 0 0 1 16 8a6.5 6.5 0 0 1 13 3.5C29 16.5 25 21 16 28Z"
          className={cn("stroke-white stroke-2 transition-colors", saved ? "fill-brand" : "fill-black/50")}
        />
      </svg>
    </button>
  );
}
