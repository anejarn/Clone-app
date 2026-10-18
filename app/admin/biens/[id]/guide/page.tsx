import { Clock, MapPin, Settings } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { CodesManager, GuidePhotos, GuideTextsForm, RecommendationsManager, WifiForm } from "@/components/admin/guide/GuideForms";
import { ListingTabs } from "@/components/admin/guide/ListingTabs";
import { AuditList } from "@/components/admin/users/AuditList";
import { recentAudit } from "@/lib/server/audit";
import { defaultMapsUrl } from "@/lib/guide/form";
import { formatTimeOfDay } from "@/lib/operations/schedule";
import { requireAdminPage } from "@/lib/server/authz";
import { getGuideEditor } from "@/lib/server/guide/admin";
import { ID_RE } from "@/lib/server/schemas";

export const metadata: Metadata = { title: "Guide d'accueil du bien" };

/** Biens → a home → Guide d'accueil (ADMIN): what its guests see in their guide (/guide/<token>). */
export default function Page({ params }: PageProps<"/admin/biens/[id]/guide">) {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { organizationId } = await requireAdminPage("/admin/biens");
  const { id } = await params;
  // Another organization's listing is "not found", as an unknown one.
  const g = ID_RE.test(id) ? await getGuideEditor(organizationId, id) : null;
  if (!g) notFound();
  const history = await recentAudit(organizationId, { targetId: g.id });
  return (
    <AdminPage
      title={g.title}
      intro={
        <>
          <Link href="/admin/biens" className="underline underline-offset-2">
            Biens
          </Link>{" "}
          · Guide d&apos;accueil · {g.placeName}
        </>
      }
    >
      <div className="space-y-5">
        <ListingTabs listingId={g.id} current="guide" />
        <div className="grid gap-3 rounded-lg border border-line bg-white p-4 text-ink md:grid-cols-3 md:p-5">
          <p className="flex items-start gap-2">
            <MapPin className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
            <span>
              {g.address}, {g.city}
            </span>
          </p>
          <p className="flex items-start gap-2">
            <Clock className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
            <span>
              Arrivée {formatTimeOfDay(g.times.checkInMinutes)} · départ {formatTimeOfDay(g.times.checkOutMinutes)}
              <span className="block text-caption text-ink-muted">{g.timesFromListing ? "Horaires propres au bien" : "Horaires de l'organisation"}</span>
            </span>
          </p>
          <p className="flex items-start gap-2">
            <Settings className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
            <span>
              Conciergerie : {g.concierge.phone ?? g.concierge.whatsapp ?? "non renseignée"} ·{" "}
              <Link href="/admin/biens/guide-commun" className="font-semibold underline underline-offset-2">
                Réglages communs
              </Link>
            </span>
          </p>
        </div>
        <p className="text-ink-muted">
          Le lien du guide se crée depuis chaque réservation (Réservations → la réservation → « Guide d&apos;accueil »). Le voyageur choisit sa langue
          (français, espagnol, anglais) ; un texte non traduit s&apos;affiche en français.
        </p>
        <GuideTextsForm
          listingId={g.id}
          mapsUrl={g.guide.mapsUrl}
          defaultMapsUrl={defaultMapsUrl(g.lat, g.lng)}
          directions={g.guide.directions}
          accessInstructions={g.guide.accessInstructions}
          houseRules={g.houseRules}
          houseRulesTranslations={g.guide.houseRulesTranslations}
          useOrgRecommendations={g.guide.useOrgRecommendations}
          orgRecommendations={g.orgRecommendations}
        />
        <div className="grid gap-5 lg:grid-cols-2">
          <WifiForm listingId={g.id} wifiName={g.guide.wifiName} hasPassword={g.guide.hasWifiPassword} />
          <GuidePhotos listingId={g.id} photos={g.photos} />
        </div>
        <CodesManager listingId={g.id} codes={g.codes.map((c) => ({ id: c.id, kind: c.kind, label: c.label }))} hasWifiPassword={g.guide.hasWifiPassword} />
        <RecommendationsManager
          listingId={g.id}
          items={g.recommendations.map((r) => ({ id: r.id, category: r.category, name: r.name, description: r.description, url: r.url }))}
          title="Recommandations du bien"
          intro="Restaurants, hammams, souks… proches de ce logement. Elles s'affichent avant les recommandations communes."
        />
        <section aria-labelledby="guide-history">
          <h2 id="guide-history" className="mb-3 text-title-s font-semibold">
            Historique (modifications et affichages des codes)
          </h2>
          <AuditList entries={history} />
        </section>
      </div>
    </AdminPage>
  );
}
