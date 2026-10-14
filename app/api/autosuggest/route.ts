import { z } from "zod";
import { suggestPlaces } from "@/lib/server/catalog";
import { handle, parseOrThrow } from "@/lib/server/http";
import { CONTROL_RE } from "@/lib/server/schemas";

/** Any length is accepted (only the first 80 characters are used), control characters are not. */
const querySchema = z
  .string()
  .refine((s) => !CONTROL_RE.test(s), "caractères non autorisés")
  .transform((s) => s.slice(0, 80));

/** GET /api/autosuggest?q=ann → places matching the query (popular places when empty). */
export const GET = handle(async (request: Request) => {
  const q = parseOrThrow(querySchema, new URL(request.url).searchParams.get("q") ?? "");
  const places = await suggestPlaces(q);
  return Response.json({ places }, { headers: { "Cache-Control": "public, max-age=300" } });
});
