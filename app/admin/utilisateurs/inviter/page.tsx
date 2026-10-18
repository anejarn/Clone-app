import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { InviteForm } from "@/components/admin/users/InviteForm";
import { INVITATION_DAYS } from "@/lib/admin/users";
import { requireAdminPage } from "@/lib/server/authz";

export const metadata: Metadata = { title: "Inviter un utilisateur" };

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
    <AdminPage
      title="Inviter"
      intro={
        <>
          <Link href="/admin/utilisateurs" className="underline underline-offset-2">
            Utilisateurs
          </Link>{" "}
          · Un lien personnel, valable {INVITATION_DAYS} jours et une seule fois, permet à la personne de créer son accès avec ce rôle.
        </>
      }
    >
      <InviteForm />
    </AdminPage>
  );
}
