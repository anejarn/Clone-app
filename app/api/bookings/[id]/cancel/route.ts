import { revalidateTag } from "next/cache";
import { TAGS } from "@/lib/data/repo";
import { cancelBooking } from "@/lib/server/bookings";
import { assertSameOrigin, handle, requireUser, wellFormedId } from "@/lib/server/http";
import { publicOrgId } from "@/lib/server/org";

/** POST /api/bookings/:id/cancel → the cancelled booking. The record is kept, with status CANCELLED. */
export const POST = handle(async (request: Request, ctx: RouteContext<"/api/bookings/[id]/cancel">) => {
  assertSameOrigin(request);
  const user = await requireUser(request);
  const id = wellFormedId((await ctx.params).id, "Réservation introuvable.");
  const booking = await cancelBooking(await publicOrgId(), user.id, id);
  revalidateTag(TAGS.availability, "max");
  return Response.json(booking);
});
