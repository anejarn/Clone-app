import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback, ComingSoon } from "@/components/admin/AdminPage";
import { requireAdminPage } from "@/lib/server/authz";

export const metadata: Metadata = { title: "Prix" };

export default function Page() {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  await requireAdminPage("/admin/prix");
  return (
    <AdminPage title="Prix">
      <ComingSoon>Prix par saison et par événement, et durée minimale de séjour par bien.</ComingSoon>
    </AdminPage>
  );
}
