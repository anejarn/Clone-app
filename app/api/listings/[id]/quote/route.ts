import { quoteStay, stayInputSchema } from "@/lib/server/bookings";
import { handle, parseOrThrow, searchParamsObject, wellFormedId } from "@/lib/server/http";
import { publicOrgId } from "@/lib/server/org";

/** GET /api/listings/:id/quote?checkin=&checkout=&adults= → price breakdown and whether the dates are free. */
export const GET = handle(async (request: Request, ctx: RouteContext<"/api/listings/[id]/quote">) => {
  const id = wellFormedId((await ctx.params).id);
  const p = searchParamsObject(request);
  // Same parameter names as the site's search URLs.
  const input = parseOrThrow(stayInputSchema, { ...p, checkIn: p.checkin, checkOut: p.checkout });
  return Response.json(await quoteStay(await publicOrgId(), id, input));
});
