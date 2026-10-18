import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { ListingRateForm, OrgRateForm, RateDeleteButton, RetentionForm } from "@/components/admin/settings/SettingsForms";
import { requireAdminPage } from "@/lib/server/authz";
import { taxSettings } from "@/lib/server/declarations/tax";
import { formatTaxAmount } from "@/lib/tax/form";

export const metadata: Metadata = { title: "Paramètres" };

const jjmmaaaa = (iso: string) => iso.split("-").reverse().join("/");
const card = "rounded-lg border border-line bg-white p-4 md:p-6";

/** Paramètres (ADMIN): taxe de séjour (rates by date, exemptions, homes' own rates) and retention of identity data. */
export default function Page() {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const access = await requireAdminPage("/admin/parametres");
  const s = await taxSettings(access.organizationId);
  return (
    <AdminPage title="Paramètres" intro="Réglages de l'organisation : taxe de séjour et conservation des pièces d'identité.">
      <div className="space-y-8">
        <section aria-labelledby="tax-title" className="space-y-4">
          <h2 id="tax-title" className="text-title-m font-semibold">
            Taxe de séjour
          </h2>
          <p role="note" className="rounded-lg border-2 border-error bg-white p-4 font-medium text-error" data-testid="tax-warning">
            Taux et exonérations à confirmer par Sigma auprès de la commune de Marrakech / du comptable : l&apos;application n&apos;en connaît aucun. Le taux de démonstration éventuel
            n&apos;est pas un taux légal.
          </p>
          <p className="text-ink-muted">
            Montant par voyageur taxable et par nuit. Un nouveau taux s&apos;applique à partir de sa date, nuit par nuit : les nuits précédentes gardent l&apos;ancien taux et les
            séjours clôturés ne changent jamais. Pas d&apos;arrondi : la taxe est calculée au centime.
          </p>
          <div className={card}>
            <h3 className="mb-3 text-title-s font-semibold">Taux de l&apos;organisation</h3>
            {s.orgRates.length === 0 ? (
              <p className="text-ink-muted" data-testid="no-tax-rate">
                Aucun taux : la taxe de séjour n&apos;est pas calculée.
              </p>
            ) : (
              <ul className="divide-y divide-line" data-testid="org-rates">
                {s.orgRates.map((r) => (
                  <li key={r.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between" data-testid="org-rate">
                    <div>
                      <p className="font-medium">
                        À partir du {jjmmaaaa(r.effectiveFrom)} : {formatTaxAmount(r.rateCents)} / voyageur / nuit
                        {r.inForce && <span className="ml-2 rounded-pill bg-brand-tint px-2 py-0.5 text-caption text-brand-deep">en vigueur</span>}
                      </p>
                      <p className="text-caption text-ink-muted">
                        {r.minorsExemptUnder === null ? "Mineurs taxés" : `Exonérés : moins de ${r.minorsExemptUnder} ans`}
                        {r.residentsExempt ? " · résidents au Maroc exonérés" : ""}
                        {r.note && ` · ${r.note}`}
                      </p>
                    </div>
                    {r.deletable && <RateDeleteButton kind="org" id={r.id} />}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <OrgRateForm today={s.today} first={s.orgRates.length === 0} />
          <div className={card}>
            <h3 className="mb-3 text-title-s font-semibold">Taux propres à un bien</h3>
            {s.listingRates.length === 0 ? (
              <p className="text-ink-muted">Aucun : tous les biens suivent le taux de l&apos;organisation.</p>
            ) : (
              <ul className="divide-y divide-line" data-testid="listing-rates">
                {s.listingRates.map((r) => (
                  <li key={r.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                    <p>
                      <span className="font-medium">{r.listingTitle}</span> · à partir du {jjmmaaaa(r.effectiveFrom)} :{" "}
                      {r.rateCents === null ? "taux de l'organisation" : `${formatTaxAmount(r.rateCents)} / voyageur / nuit`}
                      {r.note && <span className="text-caption text-ink-muted"> · {r.note}</span>}
                    </p>
                    {r.deletable && <RateDeleteButton kind="listing" id={r.id} />}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <ListingRateForm listings={s.listings} today={s.today} />
        </section>

        <section aria-labelledby="retention-title" className="space-y-4">
          <h2 id="retention-title" className="text-title-m font-semibold">
            Pièces d&apos;identité des voyageurs
          </h2>
          <p role="note" className="rounded-lg border-2 border-error bg-white p-4 font-medium text-error" data-testid="retention-warning">
            {s.retentionWarning}
          </p>
          <RetentionForm days={s.retentionDays} />
          <p className="text-caption text-ink-muted">
            Les fiches et les photos des pièces d&apos;un séjour sont supprimées automatiquement ce nombre de jours après le départ (tâche quotidienne `pnpm identity:purge`) ; il ne
            reste que le nombre de voyageurs et la date de suppression.
          </p>
        </section>
      </div>
    </AdminPage>
  );
}
