import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { DeleteButton, PartnerForm } from "@/components/admin/concierge/ConciergeForms";
import { AuditList } from "@/components/admin/users/AuditList";
import { recentAudit } from "@/lib/server/audit";
import { requireAdminPage } from "@/lib/server/authz";
import { getPartner } from "@/lib/server/concierge/admin";
import { ID_RE } from "@/lib/server/schemas";

export const metadata: Metadata = { title: "Partenaire" };

/** One partner (associés): contacts, preferred channel, notes, active; deleted only when it has no service nor request. */
export default function Page({ params }: PageProps<"/admin/conciergerie/gestion/partenaires/[id]">) {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const access = await requireAdminPage("/admin/conciergerie/gestion");
  const { id } = await params;
  // Another organization's partner: not found, like an unknown one.
  const partner = ID_RE.test(id) ? await getPartner(access, id) : null;
  if (!partner) notFound();
  const audit = await recentAudit(access.organizationId, { targetId: partner.id });
  return (
    <AdminPage title={partner.name}>
      <p className="mb-4">
        <Link href="/admin/conciergerie/gestion" className="font-semibold underline underline-offset-2">
          ← Partenaires
        </Link>
      </p>
      <div className="max-w-3xl space-y-6">
        <PartnerForm
          partner={{
            id: partner.id,
            name: partner.name,
            type: partner.type,
            phone: partner.phone ?? "",
            whatsapp: partner.whatsapp ?? "",
            email: partner.email ?? "",
            preferredChannel: partner.preferredChannel,
            notes: partner.notes,
            active: partner.active,
          }}
        />
        {partner.serviceCount === 0 && partner.requestCount === 0 && <DeleteButton kind="partner" id={partner.id} label="Supprimer le partenaire" confirm={`Supprimer ${partner.name} ?`} />}
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
