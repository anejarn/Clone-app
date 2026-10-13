import { z } from "zod";
import { assertSameOrigin, handle, idSchema, readJson, requireUser } from "@/lib/server/http";
import { MAX_SAVED, mergeWishlist, wishlistIds } from "@/lib/server/wishlist";

/** GET /api/wishlist → { ids } saved by the signed-in user, most recent first. */
export const GET = handle(async (request: Request) => {
  const user = await requireUser(request);
  return Response.json({ ids: await wishlistIds(user.id) });
});

const mergeSchema = z.object({ ids: z.array(idSchema).max(MAX_SAVED) });

/** POST /api/wishlist { ids } → merges favourites saved while signed out; returns the full list. */
export const POST = handle(async (request: Request) => {
  assertSameOrigin(request);
  const user = await requireUser(request);
  const { ids } = await readJson(request, mergeSchema);
  return Response.json({ ids: await mergeWishlist(user.id, ids) });
});
