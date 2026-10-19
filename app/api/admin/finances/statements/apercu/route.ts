import { isMonth } from "@/lib/finance/months";
import { requireAdminApi } from "@/lib/server/authz";
import { privateFileResponse } from "@/lib/server/files";
import { previewStatementPdf } from "@/lib/server/finance/statements";
import { errorResponse, handle, ID_RE, searchParamsObject } from "@/lib/server/http";

/**
 * GET /api/admin/finances/statements/apercu?mois=yyyy-MM&proprietaire=<id> → an owner's statement as it would be
 * now (PDF drawn on the fly, never stored): « Provisoire » watermark while the month is open. Associés only;
 * another organization's owner is 404.
 */
export const GET = handle(async (request: Request) => {
  const access = await requireAdminApi(request, "/admin/finances");
  const q = searchParamsObject(request);
  if (!isMonth(q.mois) || !q.proprietaire || !ID_RE.test(q.proprietaire)) return errorResponse(400, "INVALID_INPUT", "mois (AAAA-MM) et proprietaire requis.");
  const file = await previewStatementPdf(access, q.proprietaire, q.mois);
  if (!file) return errorResponse(404, "NOT_FOUND", "Propriétaire introuvable.");
  return privateFileResponse(file.bytes, "application/pdf", file.filename);
});
