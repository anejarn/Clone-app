import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { FinanceSettingsForm, ListingTermsForm } from "@/components/admin/finances/FinanceForms";
import { BrandingForm } from "@/components/admin/finances/StatementForms";
import { formatRate } from "@/lib/finance/fx";
import { FinanceTabs } from "@/components/admin/finances/FinanceViews";
import { MANAGEMENT_LABEL } from "@/lib/finance/labels";
import { PLATFORM_SOURCES } from "@/lib/finance/platform-fees";
import { bpsToPercent, centimesToDirhams } from "@/lib/money";
import { requireAdminPage } from "@/lib/server/authz";
import { getFinanceSettings, listingTerms } from "@/lib/server/finance/ledger";
import { organizationBranding } from "@/lib/server/finance/statements";

export const metadata: Metadata = { title: "Paramètres financiers" };

/** The organization's split rules and each home's financial terms (ADMIN). */
export default function Page() {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const access = await requireAdminPage("/admin/finances");
  const [s, listings, b] = await Promise.all([getFinanceSettings(access.organizationId), listingTerms(access.organizationId), organizationBranding(access.organizationId)]);
  const defaults: Record<string, string> = {
    cleaningBeneficiary: s.cleaningBeneficiary,
    commissionBase: s.commissionBase,
    allocation: s.allocation,
    ...Object.fromEntries(PLATFORM_SOURCES.map((p) => [`fee_${p}`, bpsToPercent(s.platformFeeBps[p])])),
  };
  return (
    <AdminPage title="Paramètres financiers" intro="Règles à confirmer avec le comptable de Sigma. Elles s'appliquent aux réservations calculées ensuite ; une réservation déjà calculée garde les siennes (bouton « Réappliquer » sur sa page).">
      <FinanceTabs current="/admin/finances/parametres" />
      <div className="space-y-6">
        <FinanceSettingsForm defaults={defaults} />
        <BrandingForm
          defaults={{ legalName: b.legalName, legalAddress: b.legalAddress, ice: b.ice, rcNumber: b.rcNumber, taxIdNumber: b.taxIdNumber, eurRate: b.eurRateMicros ? formatRate(b.eurRateMicros) : "", hasLogo: b.hasLogo }}
        />
        <section aria-labelledby="terms-title" className="rounded-lg border border-line bg-white p-4 md:p-6">
          <h2 id="terms-title" className="text-title-s font-semibold">
            Conditions par bien
          </h2>
          <p className="mt-1 text-caption text-ink-muted">
            Commission par défaut de l&apos;organisation : {bpsToPercent(s.defaultCommissionBps)} % (la commission d&apos;un bien se règle sur sa fiche, Biens). Mandat « gestion à distance » : choisir « Le propriétaire » pour le ménage.
          </p>
          <ul className="mt-4 divide-y divide-line-soft">
            {listings.map((l) => (
              <li key={l.listingId} className="space-y-2 py-3">
                <p>
                  <span className="font-medium">{l.title}</span>{" "}
                  <span className="text-caption text-ink-muted">
                    · {MANAGEMENT_LABEL[l.managementType]}
                    {l.managementType === "MANAGED" && ` ${bpsToPercent(l.commissionBps)} %`} · {l.ownerName}
                  </span>
                </p>
                <ListingTermsForm
                  listingId={l.listingId}
                  sublease={l.managementType === "SUBLEASE"}
                  defaults={{ cleaningFeeBeneficiary: l.cleaningFeeBeneficiary ?? "", subleaseRent: l.subleaseRentCents === null ? "" : centimesToDirhams(l.subleaseRentCents), subleaseRentFrom: l.subleaseRentFrom ?? "" }}
                />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </AdminPage>
  );
}
