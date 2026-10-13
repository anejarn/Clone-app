import { listingCalendar } from "@/lib/ical";
import { confirmedStays } from "@/lib/server/catalog";
import { AppError } from "@/lib/server/errors";
import { handle, wellFormedId } from "@/lib/server/http";

/**
 * GET /api/listings/:id/calendar.ics → iCalendar feed with one all-day event per confirmed stay, so owners
 * can block the nights sold on Nidou on their other channels. No guest data.
 */
export const GET = handle(async (_request: Request, ctx: RouteContext<"/api/listings/[id]/calendar.ics">) => {
  const id = wellFormedId((await ctx.params).id);
  const stays = await confirmedStays(id);
  if (!stays) throw new AppError(404, "NOT_FOUND", "Logement introuvable.");
  return new Response(listingCalendar(id, stays), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="nidou-${id}.ics"`,
      // Calendar importers poll this feed: always answer with the current bookings.
      "Cache-Control": "no-store",
    },
  });
});
