import { getListing } from "@/lib/server/catalog";
import { AppError } from "@/lib/server/errors";
import { handle, wellFormedId } from "@/lib/server/http";
import { publicOrgId } from "@/lib/server/org";

/** GET /api/listings/:id → listing detail with photos, amenities and latest reviews. Never the owner. */
export const GET = handle(async (_request: Request, ctx: RouteContext<"/api/listings/[id]">) => {
  const id = wellFormedId((await ctx.params).id);
  const listing = await getListing(await publicOrgId(), id);
  if (!listing) throw new AppError(404, "NOT_FOUND", "Logement introuvable.");
  const { amenities, ...rest } = listing;
  return Response.json({ ...rest, amenities: amenities.map((a) => a.amenity) });
});
