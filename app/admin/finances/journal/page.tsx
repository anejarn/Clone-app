import { Download } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { AdjustmentForm } from "@/components/admin/finances/FinanceForms";
import { EntriesTable, FinanceTabs } from "@/components/admin/finances/FinanceViews";
import { addMonths, isMonth, localMonth } from "@/lib/finance/months";
import { requireAdminPage } from "@/lib/server/authz";
import { db } from "@/lib/server/db";
import { entryViews } from "@/lib/server/finance/bookings";
import { closedMonthList, journalWhere, recentMonths } from "@/lib/server/finance/ledger";
import { ID_RE } from "@/lib/server/schemas";

export const metadata: Metadata = { title: "Journal financier" };

const PAGE = 300;

/** The journal of every financial operation (ADMIN), filters, CSV exports, manual adjustments. */
export default function Page({ searchParams }: PageProps<"/admin/finances/journal">) {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireAdminPage("/admin/finances");
  const { organizationId } = access;
  const sp = await searchParams;
  const current = localMonth(new Date());
  const from = isMonth(sp.du) ? sp.du : addMonths(current, -1);
  const to = isMonth(sp.au) && sp.au >= from ? sp.au : current;
  const listingId = typeof sp.bien === "string" && ID_RE.test(sp.bien) ? sp.bien : undefined;
  const ownerId = typeof sp.proprietaire === "string" && ID_RE.test(sp.proprietaire) ? sp.proprietaire : undefined;
  const f = { from, to, listingId, ownerId };
  const [rows, count, listings, owners, closed] = await Promise.all([
    db.financialEntry.findMany({ where: journalWhere(organizationId, f), orderBy: { seq: "desc" }, take: PAGE }),
    db.financialEntry.count({ where: journalWhere(organizationId, f) }),
    db.listing.findMany({ where: { organizationId }, select: { id: true, title: true }, orderBy: { title: "asc" } }),
    db.user.findMany({ where: { organizationId, role: "OWNER" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    closedMonthList(organizationId),
  ]);
  const entries = await entryViews(rows);
  const months = recentMonths(new Date(), 24);
  const openMonths = months.filter((m) => !closed.includes(m));
  const qs = new URLSearchParams({ du: from, au: to, ...(listingId && { bien: listingId }), ...(ownerId && { proprietaire: ownerId }) });
  const input = "h-11 rounded-sm border border-ink-faint bg-white px-3";
  return (
    <AdminPage title="Journal financier" intro="Toutes les opérations financières : qui, quand, quoi. Le journal ne se modifie jamais ; une correction est une nouvelle écriture.">
      <FinanceTabs current="/admin/finances/journal" />
      <div className="space-y-6">
        <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-white p-4" aria-label="Filtres du journal">
          <label className="text-micro font-medium">
            Du mois
            <select name="du" defaultValue={from} className={`${input} mt-1 block`}>
              {months.map((m) => (
                <option key={m} value={m}>
                  {m.slice(5)}/{m.slice(0, 4)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-micro font-medium">
            Au mois
            <select name="au" defaultValue={to} className={`${input} mt-1 block`}>
              {months.map((m) => (
                <option key={m} value={m}>
                  {m.slice(5)}/{m.slice(0, 4)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-micro font-medium">
            Bien
            <select name="bien" defaultValue={listingId ?? ""} className={`${input} mt-1 block max-w-64`}>
              <option value="">Tous</option>
              {listings.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          </label>
          <label className="text-micro font-medium">
            Propriétaire
            <select name="proprietaire" defaultValue={ownerId ?? ""} className={`${input} mt-1 block`}>
              <option value="">Tous</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="h-11 rounded-sm bg-ink px-4 font-semibold text-white">
            Filtrer
          </button>
        </form>
        <div className="flex flex-wrap gap-3">
          <a href={`/api/admin/finances/export?${qs}`} className="inline-flex h-11 items-center gap-2 rounded-sm border border-ink bg-white px-4 font-semibold hover:bg-surface-2" data-testid="journal-csv">
            <Download className="size-4" aria-hidden="true" />
            Export comptable (CSV, Excel)
          </a>
          <a href={`/api/admin/finances/export?${qs}&format=machine`} className="inline-flex h-11 items-center gap-2 rounded-sm border border-line bg-white px-4 font-medium hover:bg-surface-2" data-testid="journal-csv-machine">
            <Download className="size-4" aria-hidden="true" />
            CSV technique (centimes, dates ISO)
          </a>
        </div>
        <p className="text-caption text-ink-muted" data-testid="journal-count">
          {count} écriture{count > 1 ? "s" : ""}
          {count > PAGE ? ` (les ${PAGE} plus récentes affichées ; l'export les contient toutes)` : ""}. Mois clôturés : {closed.length ? closed.map((m) => `${m.slice(5)}/${m.slice(0, 4)}`).join(", ") : "aucun"}.
        </p>
        <EntriesTable entries={entries} />
        {openMonths.length > 0 && <AdjustmentForm listings={listings} months={openMonths} />}
      </div>
    </AdminPage>
  );
}
