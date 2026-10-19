import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { ExpenseButtons, ExpenseForm, ReceiptUpload } from "@/components/admin/finances/FinanceForms";
import { EntriesTable, FinanceTabs, mad } from "@/components/admin/finances/FinanceViews";
import { AuditList } from "@/components/admin/users/AuditList";
import { todayInTimeZone } from "@/lib/dates";
import { EXPENSE_CATEGORY_LABEL, EXPENSE_STATUS_LABEL, PAYER_LABEL } from "@/lib/finance/expense-form";
import { FINANCE_TIMEZONE } from "@/lib/finance/months";
import { centimesToDirhams } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/format";
import { recentAudit } from "@/lib/server/audit";
import { requireAdminPage } from "@/lib/server/authz";
import { db } from "@/lib/server/db";
import { entryViews } from "@/lib/server/finance/bookings";
import { getExpense } from "@/lib/server/finance/expenses";
import { ID_RE } from "@/lib/server/schemas";

export const metadata: Metadata = { title: "Dépense" };

export default function Page({ params }: PageProps<"/admin/finances/depenses/[id]">) {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const access = await requireAdminPage("/admin/finances");
  const { organizationId } = access;
  const { id } = await params;
  const e = ID_RE.test(id) ? await getExpense(organizationId, id) : null;
  if (!e) notFound();
  const [entries, history, listings] = await Promise.all([
    db.financialEntry.findMany({ where: { organizationId, expenseId: e.id }, orderBy: { seq: "asc" } }).then(entryViews),
    recentAudit(organizationId, { targetId: e.id }),
    db.listing.findMany({ where: { organizationId }, select: { id: true, title: true }, orderBy: { title: "asc" } }),
  ]);
  const today = todayInTimeZone(FINANCE_TIMEZONE).toISOString().slice(0, 10);
  const receiptUrl = `/api/finances/expenses/${e.id}/receipt`;
  return (
    <AdminPage
      title={e.description}
      intro={
        <>
          <Link href="/admin/finances/depenses" className="underline underline-offset-2">
            Dépenses
          </Link>{" "}
          · {e.listingTitle}
        </>
      }
    >
      <FinanceTabs current="/admin/finances/depenses" />
      <div className="space-y-5">
        <section className="rounded-lg border border-line bg-white p-4 md:p-6" data-testid="expense-detail" data-status={e.status}>
          <p className="text-title-s font-semibold">
            {mad(e.amountCents)} TTC · <span data-testid="expense-status">{EXPENSE_STATUS_LABEL[e.status]}</span>
          </p>
          <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <dt className="text-caption text-ink-muted">Date</dt>
              <dd>{formatDate(new Date(`${e.date}T00:00:00Z`))}</dd>
            </div>
            <div>
              <dt className="text-caption text-ink-muted">Catégorie</dt>
              <dd>{EXPENSE_CATEGORY_LABEL[e.category]}</dd>
            </div>
            <div>
              <dt className="text-caption text-ink-muted">Fournisseur</dt>
              <dd>{e.supplier || "—"}</dd>
            </div>
            <div>
              <dt className="text-caption text-ink-muted">Paiement</dt>
              <dd>
                {PAYER_LABEL[e.paidBy]} · {e.rebillToOwner ? `refacturée à ${e.ownerName ?? "au propriétaire"}` : "à la charge de Sigma"}
              </dd>
            </div>
            {e.ticketId && (
              <div>
                <dt className="text-caption text-ink-muted">Panne</dt>
                <dd>
                  <Link href={`/admin/pannes/${e.ticketId}`} className="underline underline-offset-2">
                    Voir la panne
                  </Link>
                </dd>
              </div>
            )}
            <div>
              <dt className="text-caption text-ink-muted">Justificatif</dt>
              <dd data-testid="expense-receipt">
                {e.receipt ? (
                  <a href={receiptUrl} target="_blank" rel="noopener" className="underline underline-offset-2">
                    Ouvrir ({e.receipt.contentType === "application/pdf" ? "PDF" : "photo"}, {Math.ceil(e.receipt.size / 1024)} Ko)
                  </a>
                ) : (
                  "Aucun"
                )}
              </dd>
            </div>
          </dl>
          {e.validatedAt && <p className="mt-3 text-caption text-ink-muted">Validée le {formatDateTime(new Date(e.validatedAt))}.</p>}
          {e.reversedAt && (
            <p className="mt-1 text-caption text-ink-muted">
              Contre-passée le {formatDateTime(new Date(e.reversedAt))} : {e.reversalReason}
            </p>
          )}
          <div className="mt-4 space-y-4">
            {(e.status === "DRAFT" || (e.status === "VALIDATED" && !e.receipt)) && <ReceiptUpload expenseId={e.id} replace={!!e.receipt} />}
            {e.status !== "REVERSED" && <ExpenseButtons expenseId={e.id} status={e.status} />}
            {e.status !== "DRAFT" && (
              <Link href="/admin/finances/depenses#nouvelle" className="inline-block text-caption underline underline-offset-2">
                Saisir une dépense corrigée
              </Link>
            )}
          </div>
        </section>
        {e.status === "DRAFT" && (
          <ExpenseForm
            listings={listings}
            today={today}
            expenseId={e.id}
            defaults={{ listingId: e.listingId, date: e.date, category: e.category, description: e.description, supplier: e.supplier, amount: centimesToDirhams(e.amountCents), paidBy: e.paidBy, rebillToOwner: e.rebillToOwner ? "on" : "", ticketId: e.ticketId ?? "" }}
          />
        )}
        <section aria-labelledby="entries-title">
          <h2 id="entries-title" className="mb-3 text-title-s font-semibold">
            Écritures au journal
          </h2>
          <EntriesTable entries={entries} testId="expense-ledger" />
        </section>
        <section aria-labelledby="history-title">
          <h2 id="history-title" className="mb-3 text-title-s font-semibold">
            Historique
          </h2>
          <AuditList entries={history} />
        </section>
      </div>
    </AdminPage>
  );
}
