import { suggestPlaces } from "@/lib/server/catalog";
import { handle } from "@/lib/server/http";

/** GET /api/autosuggest?q=ann → places matching the query (popular places when empty). */
export const GET = handle(async (request: Request) => {
  const q = (new URL(request.url).searchParams.get("q") ?? "").slice(0, 80);
  const places = await suggestPlaces(q);
  return Response.json({ places }, { headers: { "Cache-Control": "public, max-age=300" } });
});
