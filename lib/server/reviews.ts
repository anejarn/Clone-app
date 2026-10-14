import "server-only";
import { z } from "zod";
import { db } from "./db";
import { AppError } from "./errors";
import { utcToday } from "./bookings";

export const reviewInputSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  body: z.string().trim().min(10, "Votre commentaire est trop court.").max(2000),
});

/**
 * Guests review a listing after a completed confirmed stay, once per stay. Updates the listing's
 * denormalised rating in the same transaction.
 */
export async function createReview(authorId: string, listingId: string, input: z.infer<typeof reviewInputSchema>, today = utcToday()) {
  return db.$transaction(async (tx) => {
    const [stays, reviews] = await Promise.all([
      tx.booking.count({ where: { listingId, guestId: authorId, status: "CONFIRMED", checkOut: { lte: today } } }),
      tx.review.count({ where: { listingId, authorId } }),
    ]);
    if (stays === 0) throw new AppError(403, "NO_STAY", "Seuls les voyageurs ayant séjourné ici peuvent laisser un commentaire.");
    if (reviews >= stays) throw new AppError(409, "ALREADY_REVIEWED", "Vous avez déjà commenté chacun de vos séjours ici.");

    const review = await tx.review.create({
      data: { listingId, authorId, rating: input.rating, body: input.body },
      select: { id: true, rating: true, body: true, createdAt: true },
    });
    const agg = await tx.review.aggregate({ where: { listingId }, _avg: { rating: true }, _count: true });
    await tx.listing.update({
      where: { id: listingId },
      data: { reviewCount: agg._count, ratingAvg: agg._avg.rating === null ? null : Math.round(agg._avg.rating * 100) / 100 },
    });
    return review;
  });
}
