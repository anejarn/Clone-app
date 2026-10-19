import { Mail, MessageCircle, Phone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { PartnerForm } from "@/components/admin/concierge/ConciergeForms";
import { PARTNER_CHANNEL_LABEL, SERVICE_CATEGORY_LABEL } from "@/lib/concierge/catalog";
import { pluralize } from "@/lib/format";
import { requireAdminPage } from "@/lib/server/authz";
import { listPartners } from "@/lib/server/concierge/admin";

export const metadata: Metadata = { title: "Partenaires" };

/** The conciergerie's partners (car rental, guides, chefs, hammams…), associés only: list and new partner. */
export default function Page({ searchParams }: PageProps<"/admin/conciergerie/gestion">) {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireAdminPage("/admin/conciergerie/gestion");
  const [partners, sp] = await Promise.all([listPartners(access), searchParams]);
  return (
    <AdminPage title="Partenaires" intro="Les prestataires qui réalisent les services de la conciergerie. Leurs coordonnées ne sont jamais montrées aux voyageurs.">
      <p className="mb-4">
        <Link href="/admin/conciergerie" className="font-semibold underline underline-offset-2">
          ← Catalogue des services
        </Link>
      </p>
      {sp.supprime === "1" && (
        <p role="status" className="mb-4 rounded-sm bg-brand-tint p-3 font-medium text-brand-deep">
          Partenaire supprimé.
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <section aria-labelledby="partners-title">
          <h2 id="partners-title" className="mb-3 text-title-s font-semibold">
            {pluralize(partners.length, "partenaire", "partenaires")}
          </h2>
          {partners.length === 0 ? (
            <p className="rounded-lg border border-line bg-white p-5 text-ink-muted">Aucun partenaire pour l&apos;instant : ajoutez-en un pour créer des services.</p>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line bg-white" data-testid="partner-rows">
              {partners.map((p) => (
                <li key={p.id} className="p-3 md:px-4" data-testid="partner-row">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <Link href={`/admin/conciergerie/gestion/partenaires/${p.id}`} className="font-semibold hover:underline">
                      {p.name}
                    </Link>
                    {!p.active && <span className="rounded-pill bg-surface-3 px-2.5 py-0.5 text-micro font-semibold text-ink">Désactivé</span>}
                  </div>
                  <p className="text-caption text-ink-muted">
                    {SERVICE_CATEGORY_LABEL[p.type]} · préfère {PARTNER_CHANNEL_LABEL[p.preferredChannel]} · {pluralize(p.serviceCount, "service", "services")} · {pluralize(p.requestCount, "demande", "demandes")}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-caption">
                    {p.whatsapp && (
                      <span className="inline-flex items-center gap-1" dir="ltr">
                        <MessageCircle className="size-3.5" aria-hidden="true" />
                        {p.whatsapp}
                      </span>
                    )}
                    {p.phone && (
                      <span className="inline-flex items-center gap-1" dir="ltr">
                        <Phone className="size-3.5" aria-hidden="true" />
                        {p.phone}
                      </span>
                    )}
                    {p.email && (
                      <span className="inline-flex items-center gap-1">
                        <Mail className="size-3.5" aria-hidden="true" />
                        {p.email}
                      </span>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
        <PartnerForm />
      </div>
    </AdminPage>
  );
}
