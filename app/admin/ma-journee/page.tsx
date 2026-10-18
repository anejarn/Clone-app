import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { MyDay } from "@/components/admin/journee/MyDay";
import { requireAdminPage } from "@/lib/server/authz";

export const metadata: Metadata = { title: "Ma journée" };

/**
 * « Ma journée »: today's and tomorrow's tasks of the person signed in, on a phone, with or without network. This
 * page only checks access and draws the frame; the tasks come from GET /api/admin/journee and are kept on the device
 * (components/admin/journee/MyDay.tsx, lib/offline/). Installable from the browser menu (app/equipe.webmanifest).
 */
export default function Page() {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const { user } = await requireAdminPage("/admin/ma-journee");
  return (
    <AdminPage
      title="Ma journée"
      intro={
        <>
          Vos tâches d&apos;aujourd&apos;hui et de demain, même sans réseau : cochez, photographiez et terminez, tout est envoyé au retour de la
          connexion. Pour l&apos;installer, choisissez « Ajouter à l&apos;écran d&apos;accueil » dans le menu du navigateur.{" "}
          <Link href="/admin/mes-taches" className="underline underline-offset-2">
            Autres jours
          </Link>
        </>
      }
    >
      <MyDay user={{ id: user.id, name: user.name }} />
    </AdminPage>
  );
}
