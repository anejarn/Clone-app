import { checkAccess } from "@/lib/server/authz";
import { privateFileResponse } from "@/lib/server/files";
import { readStatementPdf } from "@/lib/server/finance/statements";
import { errorResponse, handle, ID_RE } from "@/lib/server/http";

/**
 * GET /api/finances/statements/<id>[?telecharger=1] → a stored owner statement (PDF, Lot 6b): to the associés of its
 * organization (with double authentification) and to its own owner (owner portal). Everything else — another owner,
 * another organization, an agent, a guest, an unknown id — is the same 404, so the answer never tells whether a
 * statement exists. The file is checked against its SHA-256 before it is sent.
 */
export const GET = handle(async (request: Request, ctx: RouteContext<"/api/finances/statements/[id]">) => {
  const missing = () => errorResponse(404, "NOT_FOUND", "Relevé introuvable.");
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return missing();
  const access = await checkAccess(["ADMIN", "OWNER"], { headers: request.headers });
  if (!access.ok) return missing();
  const file = await readStatementPdf({ userId: access.user.id, role: access.user.role, organizationId: access.organizationId }, id);
  if (!file) return missing();
  return privateFileResponse(file.bytes, "application/pdf", file.filename, !new URL(request.url).searchParams.has("telecharger"));
});
