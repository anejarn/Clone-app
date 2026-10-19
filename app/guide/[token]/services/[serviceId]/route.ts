import { guestServicePhoto } from "@/lib/server/concierge/guest";
import { errorResponse, handle } from "@/lib/server/http";
import { clientKey } from "@/lib/server/rate-limit";
import { ID_RE } from "@/lib/server/schemas";
import { fileStorage } from "@/lib/storage";

/**
 * GET /guide/<token>/services/<id> → the photo of an active service of the link's organization (Lot 4b), for the
 * holder of a working guide link only (lib/server/concierge/guest.ts). Never cached, never sent as a referrer.
 */
export const GET = handle(async (request: Request, ctx: RouteContext<"/guide/[token]/services/[serviceId]">) => {
  const { token, serviceId } = await ctx.params;
  const missing = () => errorResponse(404, "NOT_FOUND", "Fichier introuvable.");
  if (!ID_RE.test(serviceId)) return missing();
  const key = await guestServicePhoto(token, serviceId, new Date(), clientKey(request.headers));
  if (!key) return missing();
  const file = await fileStorage().get(key);
  if (!file) return missing();
  return new Response(file.bytes as Uint8Array<ArrayBuffer>, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.bytes.byteLength),
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
});
