import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { DeleteButton, ServiceForm, ServicePhotoForm } from "@/components/admin/concierge/ConciergeForms";
import { AuditList } from "@/components/admin/users/AuditList";
import { pluralize } from "@/lib/format";
import { recentAudit } from "@/lib/server/audit";
import { requireAdminPage } from "@/lib/server/authz";
import { getService, partnerChoices } from "@/lib/server/concierge/admin";
import { ID_RE } from "@/lib/server/schemas";

export const metadata: Metadata = { title: "Service" };

/** One service of the catalogue (associés): texts, prices and margin, options, photo, journal. */
export default function Page({ params, searchParams }: PageProps<"/admin/conciergerie/gestion/services/[id]">) {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireAdminPage("/admin/conciergerie/gestion");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  // Another organization's service: not found, like an unknown one.
  const service = ID_RE.test(id) ? await getService(access, id) : null;
  if (!service) notFound();
  const [partners, audit] = await Promise.all([partnerChoices(access, service.partner?.id), recentAudit(access.organizationId, { targetId: service.id })]);
  return (
    <AdminPage title={service.title.fr ?? "Service"} intro={service.requestCount ? `${pluralize(service.requestCount, "demande", "demandes")} : les demandes passées gardent le prix du moment où elles ont été faites.` : undefined}>
      <p className="mb-4">
        <Link href="/admin/conciergerie" className="font-semibold underline underline-offset-2">
          ← Catalogue des services
        </Link>
      </p>
      {sp.cree === "1" && (
        <p role="status" className="mb-4 rounded-sm bg-brand-tint p-3 font-medium text-brand-deep">
          Service créé.
        </p>
      )}
      <div className="max-w-4xl space-y-6">
        <ServiceForm
          partners={partners}
          service={{
            id: service.id,
            partnerId: service.partner?.id ?? "",
            category: service.category,
            title: service.title,
            description: service.description,
            availability: service.availability,
            pricingModel: service.pricingModel,
            salePriceCents: service.salePriceCents,
            partnerPriceCents: service.partnerPriceCents,
            options: service.options,
            leadTimeHours: service.leadTimeHours,
            position: service.position,
            active: service.active,
          }}
        />
        <ServicePhotoForm serviceId={service.id} photoUrl={service.photoUrl} />
        {service.requestCount === 0 && <DeleteButton kind="service" id={service.id} label="Supprimer le service" confirm="Supprimer ce service du catalogue ?" />}
        <section aria-labelledby="journal-title">
          <h2 id="journal-title" className="mb-3 text-title-s font-semibold">
            Journal
          </h2>
          <AuditList entries={audit} />
        </section>
      </div>
    </AdminPage>
  );
}
