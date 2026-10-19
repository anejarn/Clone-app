import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { ExpenseForm } from "@/components/admin/finances/FinanceForms";
import { FinanceTabs, mad } from "@/components/admin/finances/FinanceViews";
import { todayInTimeZone } from "@/lib/dates";
import { EXPENSE_CATEGORY_LABEL, EXPENSE_STATUS_LABEL, PAYER_LABEL } from "@/lib/finance/expense-form";
import { FINANCE_TIMEZONE, isMonth } from "@/lib/finance/months";
import { formatDate } from "@/lib/format";
import { requireAdminPage } from "@/lib/server/authz";
import { db } from "@/lib/server/db";
import { listExpenses, ticketPrefill, ticketProposals } from "@/lib/server/finance/expenses";
import { ID_RE } from "@/lib/server/schemas";

export const metadata: Metadata = { title: "Dépenses" };

/** Expenses of the homes (ADMIN): new expense with its receipt, the list, breakdowns to rebill. */
export default function Page({ searchParams }: PageProps<"/admin/finances/depenses">) {
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
  const month = isMonth(sp.mois) ? sp.mois : undefined;
  const fromTicket = typeof sp.panne === "string" && ID_RE.test(sp.panne) ? await ticketPrefill(organizationId, sp.panne) : null;
  const [expenses, proposals, listings] = await Promise.all([
    listExpenses(organizationId, { month }),
    ticketProposals(organizationId),
    db.listing.findMany({ where: { organizationId }, select: { id: true, title: true }, orderBy: { title: "asc" } }),
  ]);
  const today = todayInTimeZone(FINANCE_TIMEZONE).toISOString().slice(0, 10);
  return (
    <AdminPage title="Dépenses" intro="Réparations, achats, consommables… avec leur justificatif. Une dépense validée passe au journal et ne se modifie plus : on la contre-passe.">
      <FinanceTabs current="/admin/finances/depenses" />
      <div className="space-y-6">
        {proposals.length > 0 && (
          <section aria-labelledby="proposals-title" className="rounded-lg border border-line bg-white p-4 md:p-6" data-testid="ticket-proposals">
            <h2 id="proposals-title" className="text-title-s font-semibold">
              Pannes à refacturer sans dépense
            </h2>
            <ul className="mt-3 divide-y divide-line-soft">
              {proposals.map((p) => (
                <li key={p.ticketId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {p.title} · {p.listingTitle} · {mad(p.costCents)}
                  </span>
                  <Link href={`/admin/finances/depenses?panne=${p.ticketId}#nouvelle`} className="font-semibold underline underline-offset-2">
                    Créer la dépense
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        <div id="nouvelle">
          <ExpenseForm key={fromTicket?.ticketId ?? "new"} listings={listings} today={today} defaults={fromTicket ?? {}} />
        </div>
        <section aria-labelledby="list-title">
          <h2 id="list-title" className="mb-3 text-title-s font-semibold">
            {month ? `Dépenses de ${month.slice(5)}/${month.slice(0, 4)}` : "Dernières dépenses"}
          </h2>
          <div className="overflow-x-auto rounded-lg border border-line bg-white">
            <table className="w-full min-w-[800px] text-body" data-testid="expenses-table">
              <thead>
                <tr className="border-b border-line text-left text-caption text-ink-muted">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Bien</th>
                  <th className="px-3 py-2 font-medium">Dépense</th>
                  <th className="px-3 py-2 font-medium">Paiement</th>
                  <th className="px-3 py-2 font-medium">Statut</th>
                  <th className="px-3 py-2 text-right font-medium">Montant TTC</th>
                </tr>
              </thead>
              <tbody>
                {expenses.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-ink-muted">
                      Aucune dépense.
                    </td>
                  </tr>
                )}
                {expenses.map((e) => (
                  <tr key={e.id} className="border-t border-line-soft" data-testid="expense-row" data-status={e.status}>
                    <td className="px-3 py-2">{formatDate(new Date(`${e.date}T00:00:00Z`))}</td>
                    <td className="px-3 py-2">{e.listingTitle}</td>
                    <td className="px-3 py-2">
                      <Link href={`/admin/finances/depenses/${e.id}`} className="underline underline-offset-2">
                        {e.description}
                      </Link>
                      <span className="block text-caption text-ink-muted">
                        {EXPENSE_CATEGORY_LABEL[e.category]}
                        {e.receipt ? " · justificatif" : " · sans justificatif"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-caption">
                      {PAYER_LABEL[e.paidBy]}
                      <span className="block">{e.rebillToOwner ? "Refacturée au propriétaire" : "À la charge de Sigma"}</span>
                    </td>
                    <td className="px-3 py-2">{EXPENSE_STATUS_LABEL[e.status]}</td>
                    <td className="px-3 py-2 text-right font-medium">{mad(e.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AdminPage>
  );
}
