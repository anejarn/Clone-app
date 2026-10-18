import { requireAdminApi } from "@/lib/server/authz";
import { readTravelerDocument } from "@/lib/server/declarations/travelers";
import { errorResponse, handle, wellFormedId } from "@/lib/server/http";

/**
 * GET /api/admin/declarations/documents/<id> → a traveller's identity document, decrypted (stored encrypted by
 * lib/storage: lib/secrets/identity.ts). Associés of its organization only (roles of /admin/declarations), every view
 * audited « traveler.document_viewed »; never cached, sandboxed. Anything else is 404, so the answer never tells
 * whether a document exists. Agents never see a scan, not even the one they took.
 */
export const GET = handle(async (request: Request, ctx: RouteContext<"/api/admin/declarations/documents/[id]">) => {
  const access = await requireAdminApi(request, "/admin/declarations");
  const id = wellFormedId((await ctx.params).id, "Document introuvable.");
  const doc = await readTravelerDocument(access, id);
  if (!doc) return errorResponse(404, "NOT_FOUND", "Document introuvable.");
  return new Response(doc.bytes as Uint8Array<ArrayBuffer>, {
    headers: {
      "Content-Type": doc.contentType,
      "Content-Length": String(doc.bytes.byteLength),
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
});
