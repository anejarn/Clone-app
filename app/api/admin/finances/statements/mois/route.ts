import { isMonth } from "@/lib/finance/months";
import { requireAdminApi } from "@/lib/server/authz";
import { privateFileResponse } from "@/lib/server/files";
import { monthStatementsPdf } from "@/lib/server/finance/statements";
import { errorResponse, handle, searchParamsObject } from "@/lib/server/http";

/**
 * GET /api/admin/finances/statements/mois?mois=yyyy-MM → every owner's latest statement of the month in one PDF, to
 * print or archive (downloaded). Associés only; 404 when the month has no statement yet.
 */
export const GET = handle(async (request: Request) => {
  const access = await requireAdminApi(request, "/admin/finances");
  const q = searchParamsObject(request);
  if (!isMonth(q.mois)) return errorResponse(400, "INVALID_INPUT", "mois : AAAA-MM.");
  const bytes = await monthStatementsPdf(access, q.mois);
  if (!bytes) return errorResponse(404, "NOT_FOUND", "Aucun relevé pour ce mois.");
  return privateFileResponse(bytes, "application/pdf", `releves_${q.mois}.pdf`, false);
});
