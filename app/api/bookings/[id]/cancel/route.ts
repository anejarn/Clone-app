import { revalidateTag } from "next/cache";
import { TAGS } from "@/lib/data/repo";
import { cancelBooking } from "@/lib/server/bookings";
import { assertSameOrigin, handle, requireUser } from "@/lib/server/http";

/** POST /api/bookings/:id/cancel → the cancelled booking. The record is kept, with status CANCELLED. */
export const POST = handle(async (request: Request, ctx: RouteContext<"/api/bookings/[id]/cancel">) => {
  assertSameOrigin(request);
  const user = await requireUser(request);
  const { id } = await ctx.params;
  const booking = await cancelBooking(user.id, id);
  revalidateTag(TAGS.availability, "max");
  return Response.json(booking);
});
