import { assertSameOrigin, handle, requireUser } from "@/lib/server/http";
import { saveListing, unsaveListing } from "@/lib/server/wishlist";

type Ctx = RouteContext<"/api/wishlist/[listingId]">;

/** PUT /api/wishlist/:listingId → saved (idempotent). */
export const PUT = handle(async (request: Request, ctx: Ctx) => {
  assertSameOrigin(request);
  const user = await requireUser(request);
  await saveListing(user.id, (await ctx.params).listingId);
  return new Response(null, { status: 204 });
});

/** DELETE /api/wishlist/:listingId → removed (idempotent). */
export const DELETE = handle(async (request: Request, ctx: Ctx) => {
  assertSameOrigin(request);
  const user = await requireUser(request);
  await unsaveListing(user.id, (await ctx.params).listingId);
  return new Response(null, { status: 204 });
});
