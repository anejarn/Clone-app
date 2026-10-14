"use server";

import { refresh, updateTag } from "next/cache";
import { TAGS } from "@/lib/data/repo";
import { getCurrentUser } from "@/lib/server/auth";
import { cancelBooking } from "@/lib/server/bookings";
import { AppError } from "@/lib/server/errors";
import { ID_RE } from "@/lib/server/schemas";

export async function cancelTrip(bookingId: string): Promise<{ error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Connectez-vous pour continuer." };
  // Same answer as an unknown booking, without a query.
  if (typeof bookingId !== "string" || !ID_RE.test(bookingId)) return { error: "Réservation introuvable." };
  try {
    await cancelBooking(user.id, bookingId);
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  updateTag(TAGS.availability);
  refresh();
  return {};
}
