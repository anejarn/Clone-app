import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback, ComingSoon } from "@/components/admin/AdminPage";
import { requireAdminPage } from "@/lib/server/authz";

export const metadata: Metadata = { title: "Biens" };

export default function Page() {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  await requireAdminPage("/admin/biens");
  return (
    <AdminPage title="Biens">
      <ComingSoon>Fiche de chaque bien : adresse, photos, équipements, codes d&apos;accès, autorisation loi 80-14 avec alerte 60 jours avant l&apos;expiration, commission et type de gestion.</ComingSoon>
    </AdminPage>
  );
}
