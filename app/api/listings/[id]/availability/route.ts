import { z } from "zod";
import { BOOKING_WINDOW_DAYS, utcToday } from "@/lib/server/bookings";
import { bookedRanges } from "@/lib/server/catalog";
import { AppError } from "@/lib/server/errors";
import { handle, parseOrThrow, searchParamsObject } from "@/lib/server/http";
import { fromISODate, isoDate, toISODate } from "@/lib/search/params";

const schema = z.object({ from: isoDate.optional(), to: isoDate.optional() });

/** GET /api/listings/:id/availability?from=&to= → booked ranges (checkout exclusive). Defaults to the next year. */
export const GET = handle(async (request: Request, ctx: RouteContext<"/api/listings/[id]/availability">) => {
  const { id } = await ctx.params;
  const q = parseOrThrow(schema, searchParamsObject(request));
  const from = q.from ? fromISODate(q.from) : utcToday();
  const to = q.to ? fromISODate(q.to) : new Date(from.getTime() + BOOKING_WINDOW_DAYS * 86_400_000);
  if (to <= from) throw new AppError(400, "INVALID_INPUT", "to doit être après from.");
  return Response.json({ listingId: id, from: toISODate(from), to: toISODate(to), booked: await bookedRanges(id, from, to) });
});
