import { assertSameOrigin, handle, ID_RE, requireUser, wellFormedId } from "@/lib/server/http";
import { saveListing, unsaveListing } from "@/lib/server/wishlist";

type Ctx = RouteContext<"/api/wishlist/[listingId]">;

/** PUT /api/wishlist/:listingId → saved (idempotent). */
export const PUT = handle(async (request: Request, ctx: Ctx) => {
  assertSameOrigin(request);
  const user = await requireUser(request);
  await saveListing(user.id, wellFormedId((await ctx.params).listingId));
  return new Response(null, { status: 204 });
});

/** DELETE /api/wishlist/:listingId → removed (idempotent). */
export const DELETE = handle(async (request: Request, ctx: Ctx) => {
  assertSameOrigin(request);
  const user = await requireUser(request);
  const { listingId } = await ctx.params;
  // A malformed id can't have been saved: nothing to remove.
  if (ID_RE.test(listingId)) await unsaveListing(user.id, listingId);
  return new Response(null, { status: 204 });
});
