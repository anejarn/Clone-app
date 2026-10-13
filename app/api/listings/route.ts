import { z } from "zod";
import { searchHomes } from "@/lib/server/catalog";
import { handle, parseOrThrow, searchParamsObject } from "@/lib/server/http";
import { ANYWHERE, parseSearchQuery } from "@/lib/search/params";

const placeSchema = z.string().trim().min(1).max(80).default(ANYWHERE);

/** GET /api/listings?place=paris&checkin=…&checkout=…&adults=2&page=1 → a page of home cards. */
export const GET = handle(async (request: Request) => {
  const params = searchParamsObject(request);
  const place = parseOrThrow(placeSchema, params.place);
  const q = parseSearchQuery(params);
  const r = await searchHomes(place, q, q.page);
  return Response.json({
    place: r.place,
    total: r.total,
    page: r.page,
    pageCount: r.pageCount,
    nights: r.nights,
    items: r.cards,
  });
});
