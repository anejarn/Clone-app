import { publicQuote, quoteStay, stayInputSchema } from "@/lib/server/bookings";
import { handle, parseOrThrow, searchParamsObject, wellFormedId } from "@/lib/server/http";

/**
 * GET /api/listings/:id/quote?checkin=&checkout=&adults=&children=&infants= → the guest's price lines
 * (stay, cleaning, taxe de séjour, all-in total), the minimum stay and whether the dates are free.
 * Commission and host payout are never part of it.
 */
export const GET = handle(async (request: Request, ctx: RouteContext<"/api/listings/[id]/quote">) => {
  const id = wellFormedId((await ctx.params).id);
  const p = searchParamsObject(request);
  // Same parameter names as the site's search URLs.
  const input = parseOrThrow(stayInputSchema, { ...p, checkIn: p.checkin, checkOut: p.checkout });
  return Response.json(publicQuote(await quoteStay(id, input)));
});
