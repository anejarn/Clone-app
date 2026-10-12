"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ListingCard } from "@/components/listing/ListingCard";
import type { CardData } from "@/lib/data/repo";
import { useWishlist } from "@/lib/wishlist";
import { getSavedCards } from "./actions";

export function SavedGrid() {
  const { ids } = useWishlist();
  const [cards, setCards] = useState<CardData[] | null>(null);

  useEffect(() => {
    let live = true;
    getSavedCards(ids).then((c) => live && setCards(c));
    return () => {
      live = false;
    };
  }, [ids]);

  if (cards === null) return <p className="text-ink-muted">Chargement…</p>;
  if (cards.length === 0) {
    return (
      <div className="max-w-md">
        <p className="text-title-s font-semibold">Créez votre première liste de favoris</p>
        <p className="mt-2 text-ink-muted">Pendant vos recherches, cliquez sur le cœur pour enregistrer les logements qui vous plaisent.</p>
        <Link href="/" className="mt-6 inline-flex h-12 items-center rounded-sm bg-ink px-6 font-semibold text-white">
          Commencer à explorer
        </Link>
      </div>
    );
  }
  return (
    <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {cards.map((c) => (
        <ListingCard key={c.id} card={c} variant="grid" />
      ))}
    </div>
  );
}
