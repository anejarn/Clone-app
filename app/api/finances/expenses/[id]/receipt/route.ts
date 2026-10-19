import { checkAccess } from "@/lib/server/authz";
import { readReceipt } from "@/lib/server/finance/expenses";
import { errorResponse, handle, ID_RE } from "@/lib/server/http";

/**
 * GET /api/finances/expenses/<id>/receipt → an expense's receipt (justificatif, Lot 6): to the associés of its
 * organization (with double authentification), and — once the expense is validated — to the owner of its home (the
 * owner portal links to it). Everything else, other organizations included, is 404, so the answer never tells
 * whether an expense exists. Never cached, sandboxed.
 */
export const GET = handle(async (request: Request, ctx: RouteContext<"/api/finances/expenses/[id]/receipt">) => {
  const missing = () => errorResponse(404, "NOT_FOUND", "Justificatif introuvable.");
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return missing();
  const access = await checkAccess(["ADMIN", "OWNER"], { headers: request.headers });
  if (!access.ok) return missing();
  const file = await readReceipt({ userId: access.user.id, role: access.user.role, organizationId: access.organizationId }, id);
  if (!file) return missing();
  return new Response(file.bytes as Uint8Array<ArrayBuffer>, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.bytes.byteLength),
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
});
