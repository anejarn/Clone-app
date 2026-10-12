"use server";

import { listingsByIds, type CardData } from "@/lib/data/repo";

export async function getSavedCards(ids: string[]): Promise<CardData[]> {
  return listingsByIds(ids.slice(0, 200).map(String));
}
