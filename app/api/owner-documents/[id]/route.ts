import { checkAccess } from "@/lib/server/authz";
import { privateFileResponse } from "@/lib/server/files";
import { errorResponse, handle, ID_RE } from "@/lib/server/http";
import { readOwnerDocument } from "@/lib/server/owner/documents";

/**
 * GET /api/owner-documents/<id> → a document shared with an owner (mandat, autorisation 80-14…, Lot 6b): to the
 * associés of its organization and to its owner; anything else is the same 404. Checked against its SHA-256.
 */
export const GET = handle(async (request: Request, ctx: RouteContext<"/api/owner-documents/[id]">) => {
  const missing = () => errorResponse(404, "NOT_FOUND", "Document introuvable.");
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return missing();
  const access = await checkAccess(["ADMIN", "OWNER"], { headers: request.headers });
  if (!access.ok) return missing();
  const file = await readOwnerDocument({ userId: access.user.id, role: access.user.role, organizationId: access.organizationId }, id);
  if (!file) return missing();
  return privateFileResponse(file.bytes, file.contentType, file.filename);
});
