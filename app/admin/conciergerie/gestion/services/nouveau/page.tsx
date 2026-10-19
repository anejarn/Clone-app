import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { ServiceForm } from "@/components/admin/concierge/ConciergeForms";
import { requireAdminPage } from "@/lib/server/authz";
import { partnerChoices } from "@/lib/server/concierge/admin";

export const metadata: Metadata = { title: "Nouveau service" };

/** A new service of the catalogue (associés): it needs an active partner. */
export default function Page() {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const access = await requireAdminPage("/admin/conciergerie/gestion");
  const partners = await partnerChoices(access);
  return (
    <AdminPage title="Nouveau service" intro="Titre et description en français (traductions espagnole et anglaise facultatives), prix de vente et prix partenaire en dirhams.">
      <p className="mb-4">
        <Link href="/admin/conciergerie" className="font-semibold underline underline-offset-2">
          ← Catalogue des services
        </Link>
      </p>
      {partners.length === 0 ? (
        <p className="rounded-lg border border-line bg-white p-5">
          Ajoutez d&apos;abord un partenaire :{" "}
          <Link href="/admin/conciergerie/gestion" className="font-semibold underline underline-offset-2">
            Partenaires
          </Link>
          .
        </p>
      ) : (
        <div className="max-w-4xl">
          <ServiceForm partners={partners} />
        </div>
      )}
    </AdminPage>
  );
}
