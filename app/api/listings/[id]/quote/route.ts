import { quoteStay, stayInputSchema } from "@/lib/server/bookings";
import { handle, parseOrThrow, searchParamsObject } from "@/lib/server/http";

/** GET /api/listings/:id/quote?checkin=&checkout=&adults= → price breakdown and whether the dates are free. */
export const GET = handle(async (request: Request, ctx: RouteContext<"/api/listings/[id]/quote">) => {
  const { id } = await ctx.params;
  const p = searchParamsObject(request);
  // Same parameter names as the site's search URLs.
  const input = parseOrThrow(stayInputSchema, { ...p, checkIn: p.checkin, checkOut: p.checkout });
  return Response.json(await quoteStay(id, input));
});
