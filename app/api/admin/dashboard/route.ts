import { dashboardCounts } from "@/lib/server/admin/dashboard";
import { requireAdminApi } from "@/lib/server/authz";
import { handle } from "@/lib/server/http";

/** GET /api/admin/dashboard → the dashboard counts of the caller's organization (same roles as /admin). */
export const GET = handle(async (request: Request) => {
  const { organizationId } = await requireAdminApi(request, "/admin");
  return Response.json(await dashboardCounts(organizationId), { headers: { "Cache-Control": "private, no-store" } });
});
