"use server";

import { z } from "zod";
import { cardsByIds } from "@/lib/server/catalog";
import type { CardData } from "@/lib/server/cards";
import { idSchema } from "@/lib/server/schemas";

const idsSchema = z.array(idSchema).max(500);

/** Card data for saved ids. Public listing data only, so it doesn't need a session. */
export async function getSavedCards(ids: string[]): Promise<CardData[]> {
  return cardsByIds(idsSchema.parse(ids));
}
