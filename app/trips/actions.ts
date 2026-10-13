"use server";

import { refresh, updateTag } from "next/cache";
import { TAGS } from "@/lib/data/repo";
import { getCurrentUser } from "@/lib/server/auth";
import { cancelBooking } from "@/lib/server/bookings";
import { AppError } from "@/lib/server/errors";

export async function cancelTrip(bookingId: string): Promise<{ error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Connectez-vous pour continuer." };
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
