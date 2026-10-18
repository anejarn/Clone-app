import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback, ComingSoon } from "@/components/admin/AdminPage";
import { requireAdminPage } from "@/lib/server/authz";

export const metadata: Metadata = { title: "Utilisateurs" };

export default function Page() {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  await requireAdminPage("/admin/utilisateurs");
  return (
    <AdminPage title="Utilisateurs">
      <ComingSoon>Invitation des propriétaires et des agents, et changement de rôle.</ComingSoon>
    </AdminPage>
  );
}
