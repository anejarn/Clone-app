import Link from "next/link";
import { formatRate } from "@/lib/finance/fx";
import { ACCOUNT_LABEL, KIND_LABEL } from "@/lib/finance/ledger";
import { ALLOCATION_LABEL, BENEFICIARY_LABEL, COMMISSION_BASE_LABEL, FEE_SOURCE_LABEL, GROSS_SOURCE_LABEL, MANAGEMENT_LABEL, SPLIT_STATUS_LABEL } from "@/lib/finance/labels";
import { monthShort } from "@/lib/finance/months";
import { bpsToPercent, centimesToDirhams } from "@/lib/money";
import { formatDateTime, formatMad } from "@/lib/format";
import type { BookingFinanceView, FinanceEntryView } from "@/lib/server/finance/bookings";
import { ReapplyTermsButton, SplitInputsForm } from "./FinanceForms";

/** Server-rendered views of Finances (Lot 6). Amounts to the centime (formatMad). */

const TABS = [
  { href: "/admin/finances", label: "Vue mensuelle" },
  { href: "/admin/finances/depenses", label: "Dépenses" },
  { href: "/admin/finances/journal", label: "Journal et export" },
  { href: "/admin/finances/parametres", label: "Paramètres" },
] as const;

export function FinanceTabs({ current }: { current: (typeof TABS)[number]["href"] }) {
  return (
    <nav aria-label="Finances" className="mb-6 flex flex-wrap gap-2">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.href === current ? "page" : undefined}
          className={`inline-flex h-11 items-center rounded-full border px-4 font-medium ${t.href === current ? "border-ink bg-ink text-white" : "border-line bg-white hover:bg-surface-2"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export const mad = (c: number) => formatMad(c);
const asInput = (c: number | null) => (c === null ? "" : centimesToDirhams(c));

export function EntriesTable({ entries, testId = "ledger-entries" }: { entries: FinanceEntryView[]; testId?: string }) {
  if (!entries.length) return <p className="text-ink-muted">Aucune écriture.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-white">
      <table className="w-full min-w-[720px] text-caption" data-testid={testId}>
        <thead>
          <tr className="border-b border-line text-left text-ink-muted">
            <th className="px-3 py-2 font-medium">N°</th>
            <th className="px-3 py-2 font-medium">Quand</th>
            <th className="px-3 py-2 font-medium">Mois</th>
            <th className="px-3 py-2 font-medium">Type</th>
            <th className="px-3 py-2 font-medium">Compte</th>
            <th className="px-3 py-2 font-medium">Libellé</th>
            <th className="px-3 py-2 font-medium">Par</th>
            <th className="px-3 py-2 text-right font-medium">Montant</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-t border-line-soft" data-testid="ledger-entry" data-account={e.account}>
              <td className="px-3 py-1.5">{e.seq}</td>
              <td className="px-3 py-1.5 whitespace-nowrap">{formatDateTime(new Date(e.createdAt))}</td>
              <td className="px-3 py-1.5">
                {monthShort(e.period)}
                {e.originPeriod && <span className="block text-ink-muted">ajuste {monthShort(e.originPeriod)}</span>}
              </td>
              <td className="px-3 py-1.5">{KIND_LABEL[e.kind]}</td>
              <td className="px-3 py-1.5">{ACCOUNT_LABEL[e.account]}</td>
              <td className="px-3 py-1.5">{e.description}</td>
              <td className="px-3 py-1.5">{e.actorName ?? "Système"}</td>
              <td className="px-3 py-1.5 text-right whitespace-nowrap">{mad(e.amountCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A booking's split (booking page, ADMIN): parts, months, terms, inputs, journal entries. */
export function SplitCard({ bookingId, f, source }: { bookingId: string; f: BookingFinanceView; source: string }) {
  const line = (label: string, cents: number, testId: string, hint?: string) => (
    <div className="flex justify-between gap-4 border-t border-line-soft py-1.5" data-testid={testId}>
      <dt>
        {label}
        {hint && <span className="block text-caption text-ink-muted">{hint}</span>}
      </dt>
      <dd className="font-medium whitespace-nowrap">{mad(cents)}</dd>
    </div>
  );
  const sublease = f.terms.managementType === "SUBLEASE";
  return (
    <section className="rounded-lg border border-line bg-white p-4 md:p-6" aria-labelledby="finance-title" data-testid="booking-finance" data-status={f.status}>
      <h2 id="finance-title" className="text-title-s font-semibold">
        Répartition financière
      </h2>
      <p className="mt-1 text-caption text-ink-muted">
        {SPLIT_STATUS_LABEL[f.status]} · {MANAGEMENT_LABEL[f.terms.managementType]}
        {!sublease && ` · commission ${bpsToPercent(f.terms.commissionBps)} %`} · ménage : {sublease ? "Sigma" : BENEFICIARY_LABEL[f.terms.cleaningBeneficiary]}
      </p>
      {f.status === "MISSING_AMOUNT" && (
        <p role="alert" className="mt-3 rounded-sm border border-error bg-[#fdecea] p-3 text-error">
          Montant inconnu (réservation importée sans montant) : saisissez le revenu brut ci-dessous.
        </p>
      )}
      {f.status === "MISSING_RATE" && f.foreignAmount && (
        <p role="alert" className="mt-3 rounded-sm border border-error bg-[#fdecea] p-3 text-error">
          Montant de la plateforme en {f.foreignAmount.currency} ({centimesToDirhams(f.foreignAmount.cents)} {f.foreignAmount.currency}) : saisissez le taux de change.
        </p>
      )}
      {f.status === "COMPLETE" && (
        <dl className="mt-4 max-w-xl" data-testid="split-lines">
          {line("Revenu brut (payé par le voyageur)", f.grossCents, "split-gross", f.grossSource ? `Source : ${GROSS_SOURCE_LABEL[f.grossSource]}${f.foreignAmount ? ` (${centimesToDirhams(f.foreignAmount.cents)} ${f.foreignAmount.currency} à ${f.inputs.fxRateMicros ? formatRate(f.inputs.fxRateMicros) : "?"})` : ""}` : undefined)}
          {line("Frais de plateforme", f.platformFeeCents, "split-fee", FEE_SOURCE_LABEL[f.feeSource])}
          {f.cleaningSigmaCents > 0 && line("Ménage (Sigma)", f.cleaningSigmaCents, "split-cleaning-sigma")}
          {f.cleaningOwnerCents > 0 && line("Ménage (propriétaire)", f.cleaningOwnerCents, "split-cleaning-owner")}
          {!sublease && line("Commission Sigma", f.commissionCents, "split-commission", `${bpsToPercent(f.terms.commissionBps)} % de ${mad(f.commissionBaseCents)}`)}
          {!sublease && line("Part propriétaire", f.ownerShareCents, "split-owner")}
          {sublease && line("Revenu de sous-location (Sigma)", f.sigmaRentalCents, "split-sigma-rental", "Le loyer au propriétaire est une dépense mensuelle.")}
          {line("Taxe de séjour (à reverser, hors revenu)", f.touristTaxCents, "split-tax")}
        </dl>
      )}
      {f.months.length > 1 && (
        <table className="mt-4 w-full max-w-xl text-caption" data-testid="split-months">
          <caption className="mb-1 text-left font-semibold">Par mois ({ALLOCATION_LABEL[f.terms.allocation].toLowerCase()})</caption>
          <thead>
            <tr className="text-left text-ink-muted">
              <th className="py-1 font-medium">Mois</th>
              <th className="py-1 font-medium">Nuits</th>
              <th className="py-1 text-right font-medium">Brut</th>
              <th className="py-1 text-right font-medium">{sublease ? "Sigma" : "Part propriétaire"}</th>
            </tr>
          </thead>
          <tbody>
            {f.months.map((m) => (
              <tr key={m.month} className="border-t border-line-soft">
                <td className="py-1">
                  {monthShort(m.month)}
                  {m.closed && " (clôturé)"}
                </td>
                <td className="py-1">{m.nights}</td>
                <td className="py-1 text-right">{mad(m.grossCents)}</td>
                <td className="py-1 text-right">{mad(sublease ? m.sigmaRentalCents : m.ownerShareCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-3 text-caption text-ink-muted">
        Base de commission : {COMMISSION_BASE_LABEL[f.terms.commissionBase].toLowerCase()}. Calculée le {formatDateTime(new Date(f.computedAt))} (version {f.version}).
        {f.inputs.updatedAt && ` Saisie par ${f.inputs.updatedByName ?? "un associé"} le ${formatDateTime(new Date(f.inputs.updatedAt))}.`}
      </p>
      {f.termsOutdated && (
        <div className="mt-3 space-y-2 rounded-sm border border-line-soft bg-surface-2 p-3">
          <p className="text-caption">Les conditions du bien ont changé depuis le calcul de cette réservation (elle garde les siennes).</p>
          <ReapplyTermsButton bookingId={bookingId} />
        </div>
      )}
      <details className="mt-4" open={f.status === "MISSING_AMOUNT" || f.status === "MISSING_RATE"}>
        <summary className="cursor-pointer font-semibold">Saisir les montants réels</summary>
        <div className="mt-2">
          <SplitInputsForm
            bookingId={bookingId}
            direct={source === "DIRECT"}
            foreignCurrency={f.foreignAmount?.currency ?? null}
            defaults={{ gross: asInput(f.inputs.grossCents), platformFee: asInput(f.inputs.platformFeeCents), fxRate: f.inputs.fxRateMicros ? formatRate(f.inputs.fxRateMicros) : "", note: f.inputs.note }}
          />
        </div>
      </details>
      <details className="mt-4">
        <summary className="cursor-pointer font-semibold">Écritures au journal ({f.entries.length})</summary>
        <div className="mt-2">
          <EntriesTable entries={f.entries} testId="booking-ledger" />
        </div>
      </details>
    </section>
  );
}
