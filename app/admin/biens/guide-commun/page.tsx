import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { ConciergeForm, RecommendationsManager } from "@/components/admin/guide/GuideForms";
import { requireAdminPage } from "@/lib/server/authz";
import { getGuideSettings } from "@/lib/server/guide/admin";

export const metadata: Metadata = { title: "Guide d'accueil : réglages communs" };

/** Settings shared by every guide of the organization (ADMIN): the conciergerie's contact, default recommendations. */
export default function Page() {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const { organizationId } = await requireAdminPage("/admin/biens");
  const s = await getGuideSettings(organizationId);
  return (
    <AdminPage
      title="Guide d'accueil : réglages communs"
      intro={
        <>
          <Link href="/admin/biens" className="underline underline-offset-2">
            Biens
          </Link>{" "}
          · valables pour tous les biens de {s.name}
        </>
      }
    >
      <div className="space-y-5">
        <ConciergeForm phone={s.conciergePhone} whatsapp={s.conciergeWhatsapp} />
        <RecommendationsManager
          listingId={null}
          items={s.recommendations.map((r) => ({ id: r.id, category: r.category, name: r.name, description: r.description, url: r.url }))}
          title="Recommandations communes"
          intro="Proposées dans le guide de chaque bien qui garde l'option « recommandations communes »."
        />
      </div>
    </AdminPage>
  );
}
