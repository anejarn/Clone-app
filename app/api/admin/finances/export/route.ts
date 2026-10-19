import { ledgerCsv } from "@/lib/finance/csv";
import { addMonths, isMonth, localMonth } from "@/lib/finance/months";
import { requireAdminApi } from "@/lib/server/authz";
import { exportJournal } from "@/lib/server/finance/ledger";
import { errorResponse, handle, ID_RE, searchParamsObject } from "@/lib/server/http";

/**
 * GET /api/admin/finances/export?du=yyyy-MM&au=yyyy-MM[&bien=<id>][&proprietaire=<id>][&format=fr|machine] → the
 * financial journal of those accounting months as CSV (lib/finance/csv.ts: « fr » for Excel and the accountant —
 * BOM, « ; », JJ/MM/AAAA, decimal comma —, « machine » for scripts — « , », ISO dates, centimes). Associés only;
 * every export audited « finance.exported »; generated on the fly, never cached. 24 months at most per file.
 */
export const GET = handle(async (request: Request) => {
  const access = await requireAdminApi(request, "/admin/finances");
  const q = searchParamsObject(request);
  const current = localMonth(new Date());
  const from = q.du ?? current;
  const to = q.au ?? from;
  if (!isMonth(from) || !isMonth(to) || to < from) return errorResponse(400, "INVALID_INPUT", "du / au : mois AAAA-MM, du ≤ au.");
  if (addMonths(from, 23) < to) return errorResponse(400, "INVALID_INPUT", "24 mois au plus par export.");
  const variant = q.format === "machine" ? "machine" : "fr";
  if (q.format && q.format !== "fr" && q.format !== "machine") return errorResponse(400, "INVALID_INPUT", "format : fr ou machine.");
  for (const id of [q.bien, q.proprietaire]) if (id !== undefined && !ID_RE.test(id)) return errorResponse(400, "INVALID_INPUT", "Identifiant invalide.");
  const rows = await exportJournal(access, { from, to, listingId: q.bien, ownerId: q.proprietaire }, variant);
  const name = `journal-financier_${from}${to !== from ? `_${to}` : ""}${variant === "machine" ? "_machine" : ""}.csv`;
  return new Response(ledgerCsv(rows, variant), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
});
