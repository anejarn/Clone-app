import { isoDay } from "@/lib/admin/calendar";
import { todayInTimeZone } from "@/lib/dates";
import { EXPORTERS } from "@/lib/declarations/exporters";
import { parseDeclarationQuery } from "@/lib/declarations/filters";
import { formatDateTime } from "@/lib/format";
import { MARRAKECH_TIMEZONE } from "@/lib/neighbourhoods";
import { requireAdminApi } from "@/lib/server/authz";
import { db } from "@/lib/server/db";
import { declarationRows } from "@/lib/server/declarations/travelers";
import { errorResponse, handle, searchParamsObject } from "@/lib/server/http";

/**
 * GET /api/admin/declarations/export?format=csv|fiches&du=&au=[&bien=][&nondeclares=1] → the travellers of the
 * arrivals in the period, for the police declaration (lib/declarations/exporters.ts; format à valider avec la DGSN).
 * Associés only (roles of /admin/declarations), audited « declaration.exported », generated on the fly from the
 * decrypted fiches: nothing is written to disk, nothing cached.
 */
export const GET = handle(async (request: Request) => {
  const access = await requireAdminApi(request, "/admin/declarations");
  const sp = searchParamsObject(request);
  const exporter = EXPORTERS[sp.format as keyof typeof EXPORTERS];
  if (!exporter) return errorResponse(400, "INVALID_INPUT", "format : csv ou fiches.");
  const q = parseDeclarationQuery(sp, todayInTimeZone(MARRAKECH_TIMEZONE));
  const rows = await declarationRows(access, q, exporter.id);
  const org = await db.organization.findUniqueOrThrow({ where: { id: access.organizationId }, select: { name: true } });
  const body = exporter.render(rows, { from: isoDay(q.from), to: isoDay(q.to), organizationName: org.name, generatedAt: formatDateTime(new Date()) });
  const name = `declaration-voyageurs_${isoDay(q.from)}_${isoDay(q.to)}.${exporter.extension}`;
  return new Response(body, {
    headers: {
      "Content-Type": exporter.contentType,
      "Content-Disposition": `${exporter.id === "csv" ? "attachment" : "inline"}; filename="${name}"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Robots-Tag": "noindex, nofollow",
      // The printable page has inline styles only: no script, no external resource, no form.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; form-action 'none'",
    },
  });
});
