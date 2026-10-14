import { getListing } from "@/lib/server/catalog";
import { AppError } from "@/lib/server/errors";
import { handle } from "@/lib/server/http";

/** GET /api/listings/:id → listing detail with photos, amenities, host and latest reviews. */
export const GET = handle(async (_request: Request, ctx: RouteContext<"/api/listings/[id]">) => {
  const { id } = await ctx.params;
  const listing = await getListing(id);
  if (!listing) throw new AppError(404, "NOT_FOUND", "Logement introuvable.");
  const { amenities, ...rest } = listing;
  return Response.json({ ...rest, amenities: amenities.map((a) => a.amenity) });
});
