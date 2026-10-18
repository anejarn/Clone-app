import { isoDay } from "@/lib/admin/calendar";
import { todayInTimeZone } from "@/lib/dates";
import { csvAmount, toCsv } from "@/lib/declarations/csv";
import { MARRAKECH_TIMEZONE } from "@/lib/neighbourhoods";
import { requireAdminApi } from "@/lib/server/authz";
import { auditTaxReportExport, monthlyTaxReport } from "@/lib/server/declarations/tax";
import { errorResponse, handle, searchParamsObject } from "@/lib/server/http";

/**
 * GET /api/admin/declarations/taxe?mois=yyyy-MM → the month's taxe de séjour by home, as CSV (UTF-8 with BOM, « ; »,
 * amounts in dirhams with two decimals). Associés only; audited; generated on the fly. No personal data.
 */
export const GET = handle(async (request: Request) => {
  const access = await requireAdminApi(request, "/admin/declarations");
  const month = searchParamsObject(request).mois ?? isoDay(todayInTimeZone(MARRAKECH_TIMEZONE)).slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return errorResponse(400, "INVALID_INPUT", "mois : yyyy-MM.");
  const report = await monthlyTaxReport(access.organizationId, month);
  await auditTaxReportExport(access, month, report.rows.length);
  const csv = toCsv(
    ["Mois", "Bien", "N° d'autorisation (loi 80-14)", "Séjours", "Nuits", "Nuitées taxables (voyageurs × nuits)", "Taxe de séjour (MAD)", "Séjours estimés (sans calcul enregistré)", "Nuits sans taux", "Séjours clôturés"],
    [
      ...report.rows.map((r) => [month, r.listingTitle, r.licenseNumber ?? "", r.stays, r.nights, r.taxableGuestNights, csvAmount(r.totalCents), r.estimated, r.missingRateNights, r.closed]),
      [month, "Total", "", report.rows.reduce((s, r) => s + r.stays, 0), report.rows.reduce((s, r) => s + r.nights, 0), report.rows.reduce((s, r) => s + r.taxableGuestNights, 0), csvAmount(report.totalCents), "", "", ""],
    ],
  );
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="taxe-de-sejour_${month}.csv"`,
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
});
