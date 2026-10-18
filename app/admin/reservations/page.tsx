import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback, ComingSoon } from "@/components/admin/AdminPage";
import { requireAdminPage } from "@/lib/server/authz";

export const metadata: Metadata = { title: "Réservations" };

export default function Page() {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  await requireAdminPage("/admin/reservations");
  return (
    <AdminPage title="Réservations">
      <ComingSoon>Liste de toutes les réservations (directes et plateformes) et saisie manuelle d&apos;une réservation prise par téléphone ou WhatsApp.</ComingSoon>
    </AdminPage>
  );
}
