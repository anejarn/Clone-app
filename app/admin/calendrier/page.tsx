import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback, ComingSoon } from "@/components/admin/AdminPage";
import { requireAdminPage } from "@/lib/server/authz";

export const metadata: Metadata = { title: "Calendrier" };

export default function Page() {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  await requireAdminPage("/admin/calendrier");
  return (
    <AdminPage title="Calendrier">
      <ComingSoon>Calendrier unifié de tous les biens, avec une couleur par source de réservation et les blocages des propriétaires.</ComingSoon>
    </AdminPage>
  );
}
