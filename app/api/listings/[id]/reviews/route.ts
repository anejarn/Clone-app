import { revalidateTag } from "next/cache";
import { TAGS } from "@/lib/data/repo";
import { assertSameOrigin, handle, readJson, requireUser, wellFormedId } from "@/lib/server/http";
import { createReview, reviewInputSchema } from "@/lib/server/reviews";

/** POST /api/listings/:id/reviews { rating, body } → 201, for guests with a completed stay. */
export const POST = handle(async (request: Request, ctx: RouteContext<"/api/listings/[id]/reviews">) => {
  assertSameOrigin(request);
  const user = await requireUser(request);
  const id = wellFormedId((await ctx.params).id);
  const review = await createReview(user.id, id, await readJson(request, reviewInputSchema));
  revalidateTag(TAGS.listings, "max");
  return Response.json(review, { status: 201 });
});
