import { errorResponse, handle } from "@/lib/server/http";
import { guestGuidePhoto } from "@/lib/server/guide/guest";
import { clientKey } from "@/lib/server/rate-limit";
import { ID_RE } from "@/lib/server/schemas";
import { fileStorage } from "@/lib/storage";

/**
 * GET /guide/<token>/photos/<id> → a photo of the access instructions, for the holder of a working guide link only
 * (same rules as the guide page: lib/server/guide/guest.ts). Never cached, never sent as a referrer.
 */
export const GET = handle(async (request: Request, ctx: RouteContext<"/guide/[token]/photos/[photoId]">) => {
  const { token, photoId } = await ctx.params;
  const missing = () => errorResponse(404, "NOT_FOUND", "Fichier introuvable.");
  if (!ID_RE.test(photoId)) return missing();
  const key = await guestGuidePhoto(token, photoId, new Date(), clientKey(request.headers));
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
