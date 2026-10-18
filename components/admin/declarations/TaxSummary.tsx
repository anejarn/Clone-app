import type { BookingTaxView } from "@/lib/server/declarations/tax";
import { formatTaxAmount } from "@/lib/tax/form";
import { TaxActions } from "./StayActions";

const jjmmaaaa = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

/**
 * The taxe de séjour of a stay as stored (snapshot), night by night, with « Calculer / Clôturer » (ADMIN). The rates and
 * exemptions come from Paramètres; to be confirmed by Sigma with the commune.
 */
export function TaxSummary({ bookingId, tax, writable }: { bookingId: string; tax: BookingTaxView | null; writable: boolean }) {
  return (
    <div className="space-y-3" data-testid="tourist-tax">
      {tax ? (
        <>
          <p>
            <span className="text-title-s font-semibold" data-testid="tourist-tax-total">
              {formatTaxAmount(tax.totalCents)}
            </span>{" "}
            <span className="text-ink-muted">
              · {tax.taxableGuestNights} nuitée{tax.taxableGuestNights > 1 ? "s" : ""} taxable{tax.taxableGuestNights > 1 ? "s" : ""} sur {tax.nights} nuit{tax.nights > 1 ? "s" : ""}
              {tax.exemptGuestNights > 0 && `, ${tax.exemptGuestNights} exonérée${tax.exemptGuestNights > 1 ? "s" : ""}`}
            </span>
          </p>
          <p className="text-caption text-ink-muted">
            {tax.basis === "TRAVELERS" ? "Calculée d'après les fiches voyageurs (complétées par la réservation)" : "Calculée d'après la réservation (aucune fiche voyageur)"}
            {tax.closedAt ? ` · clôturée le ${jjmmaaaa(tax.closedAt)}` : ""}
          </p>
          {tax.missingRateNights > 0 && (
            <p role="alert" className="text-caption font-medium text-error">
              {tax.missingRateNights} nuit{tax.missingRateNights > 1 ? "s" : ""} sans taux en vigueur : ajoutez un taux dans Paramètres.
            </p>
          )}
          {tax.lines.length > 0 && (
            <details className="rounded-sm border border-line-soft p-3">
              <summary className="cursor-pointer text-caption font-semibold">Détail par nuit</summary>
              <table className="mt-2 w-full text-caption">
                <thead>
                  <tr className="text-left text-ink-muted">
                    <th className="py-1 font-medium">Nuit</th>
                    <th className="py-1 font-medium">Taux</th>
                    <th className="py-1 font-medium">Taxables</th>
                    <th className="py-1 text-right font-medium">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {tax.lines.map((l) => (
                    <tr key={l.night} className="border-t border-line-soft">
                      <td className="py-1">{jjmmaaaa(l.night)}</td>
                      <td className="py-1">{l.rateCents === null ? "aucun taux" : formatTaxAmount(l.rateCents)}</td>
                      <td className="py-1">
                        {l.taxable}
                        {l.exempt > 0 && ` (+${l.exempt} exonéré${l.exempt > 1 ? "s" : ""})`}
                      </td>
                      <td className="py-1 text-right">{formatTaxAmount(l.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </>
      ) : (
        <p className="text-ink-muted">Pas encore calculée : elle l&apos;est dès que les voyageurs sont enregistrés.</p>
      )}
      {writable && <TaxActions bookingId={bookingId} computed={!!tax} closed={!!tax?.closedAt} />}
      <p className="text-caption text-ink-muted">Taux et exonérations : Paramètres. À confirmer par Sigma auprès de la commune / du comptable.</p>
    </div>
  );
}
