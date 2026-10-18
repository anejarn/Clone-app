import { CalendarDays, CheckCircle2, ExternalLink, MapPin, Pencil } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { LicenseNotice, ManagementBadge, StatusBadge } from "@/components/admin/listings/Badges";
import { ListingTabs } from "@/components/admin/guide/ListingTabs";
import { PhotoManager } from "@/components/admin/listings/PhotoManager";
import { licenseStateNow } from "@/lib/admin/license";
import { MANAGEMENT_TYPE_LABEL } from "@/lib/admin/listing-form";
import { todayInTimeZone } from "@/lib/dates";
import { formatDate, formatPrice, pluralize } from "@/lib/format";
import { PROPERTY_TYPE_LABEL, type PropertyTypeKey } from "@/lib/labels";
import { bpsToPercent } from "@/lib/money";
import { MARRAKECH_TIMEZONE } from "@/lib/neighbourhoods";
import { getAdminListing } from "@/lib/server/admin/listings";
import { requireAdminPage } from "@/lib/server/authz";
import { searchHref } from "@/lib/server/cards";
import { ID_RE } from "@/lib/server/schemas";

export const metadata: Metadata = { title: "Fiche du bien" };

export default function Page({ params, searchParams }: PageProps<"/admin/biens/[id]">) {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { organizationId } = await requireAdminPage("/admin/biens");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  // Another organization's listing is "not found", as an unknown one.
  const l = ID_RE.test(id) ? await getAdminListing(organizationId, id) : null;
  if (!l) notFound();
  const license = licenseStateNow(l);
  const notice = sp.cree ? "Bien créé en brouillon. Ajoutez les photos, puis publiez-le depuis « Modifier »." : sp.modifie ? "Modifications enregistrées." : null;
  const type = l.propertyType ? PROPERTY_TYPE_LABEL[l.propertyType as PropertyTypeKey] : "Logement";
  const osm = `https://www.openstreetmap.org/?mlat=${l.lat}&mlon=${l.lng}#map=17/${l.lat}/${l.lng}`;
  const groups = [...new Set(l.amenities.map((a) => a.amenity.group))];

  return (
    <AdminPage
      title={l.title}
      intro={
        <>
          <Link href="/admin/biens" className="underline underline-offset-2">
            Biens
          </Link>{" "}
          · {type} · {l.place.name} · mis à jour le {formatDate(todayInTimeZone(MARRAKECH_TIMEZONE, l.updatedAt.getTime()))}
        </>
      }
    >
      <div className="space-y-5">
        <ListingTabs listingId={l.id} current="fiche" />
        {notice && (
          <p role="status" className="flex items-center gap-2 rounded-lg border border-line bg-brand-tint p-4 font-medium text-brand-deep">
            <CheckCircle2 className="size-5 shrink-0" aria-hidden="true" />
            {notice}
          </p>
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1.5" data-testid="listing-badges">
            <StatusBadge status={l.status} />
            <ManagementBadge type={l.managementType} commissionBps={l.commissionBps} />
          </div>
          <div className="flex flex-wrap gap-3">
            {l.status === "PUBLISHED" && (
              <Link href={searchHref(l.place.slug, { pinned: l.id })} className="inline-flex h-11 items-center gap-2 rounded-sm border border-ink px-4 font-semibold hover:bg-surface-2">
                <ExternalLink className="size-4" aria-hidden="true" />
                Voir sur le site
              </Link>
            )}
            {l.category === "HOME" && (
              <Link href={`/admin/prix/apercu?bien=${l.id}`} className="inline-flex h-11 items-center gap-2 rounded-sm border border-ink px-4 font-semibold hover:bg-surface-2">
                <CalendarDays className="size-4" aria-hidden="true" />
                Calendrier des prix
              </Link>
            )}
            <Link href={`/admin/biens/${l.id}/modifier`} className="inline-flex h-11 items-center gap-2 rounded-sm bg-brand px-4 font-semibold text-white hover:bg-brand-strong">
              <Pencil className="size-4" aria-hidden="true" />
              Modifier
            </Link>
          </div>
        </div>

        <LicenseNotice fields={l} state={license} />

        <PhotoManager listingId={l.id} photos={l.photos.map((p) => ({ id: p.id, url: p.url, alt: p.alt }))} />

        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Logement">
            <Facts
              rows={[
                ["Type", type],
                ["Capacité", `${pluralize(l.maxGuests, "voyageur", "voyageurs")} · ${pluralize(l.bedrooms, "chambre", "chambres")} · ${pluralize(l.beds, "lit", "lits")} · ${String(l.bathrooms).replace(".", ",")} sdb`],
                ["Prix de base par nuit", `${formatPrice(l.priceCents)} (saisons et événements : Prix)`],
                ["Frais de ménage", formatPrice(l.cleaningFeeCents)],
                ["Séjour minimum", pluralize(l.minNights, "nuit", "nuits")],
              ]}
            />
            <p className="mt-4 whitespace-pre-line text-ink">{l.description}</p>
          </Card>

          <Card title="Propriétaire et gestion">
            <Facts
              rows={[
                ["Propriétaire", `${l.owner.name} (${l.owner.email})`],
                ["Type de gestion", MANAGEMENT_TYPE_LABEL[l.managementType]],
                ["Commission Sigma", l.managementType === "SUBLEASE" ? "Aucune (sous-location)" : `${bpsToPercent(l.commissionBps)} %`],
                ["Autorisation 80-14", l.licenseNumber ?? "En attente"],
                ["Expiration", l.licenseExpiresAt ? formatDate(l.licenseExpiresAt) : "—"],
              ]}
            />
          </Card>

          <Card title="Adresse">
            <p className="flex items-start gap-2">
              <MapPin className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
              <span>
                {l.address}
                <br />
                {l.city} · {l.place.name}
              </span>
            </p>
            <p className="mt-2 text-ink-muted">
              {String(l.lat).replace(".", ",")}, {String(l.lng).replace(".", ",")} ·{" "}
              <a href={osm} target="_blank" rel="noreferrer" className="font-semibold text-link underline underline-offset-2">
                Voir sur la carte
              </a>
            </p>
          </Card>

          <Card title="Règlement intérieur">
            {l.houseRules ? <p className="whitespace-pre-line">{l.houseRules}</p> : <p className="text-ink-muted">Aucune règle renseignée.</p>}
          </Card>

          <Card title="Équipements" className="lg:col-span-2">
            {groups.length === 0 ? (
              <p className="text-ink-muted">Aucun équipement renseigné.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {groups.map((g) => (
                  <div key={g}>
                    <p className="font-semibold">{g}</p>
                    <ul className="mt-1 list-disc pl-5">
                      {l.amenities
                        .filter((a) => a.amenity.group === g)
                        .map((a) => (
                          <li key={a.amenity.id}>{a.amenity.label}</li>
                        ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </AdminPage>
  );
}

function Card({ title, className, children }: { title: string; className?: string; children: ReactNode }) {
  return (
    <section className={`rounded-lg border border-line bg-white p-4 md:p-6 ${className ?? ""}`}>
      <h2 className="mb-3 text-title-s font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-4 gap-y-2">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-muted">{k}</dt>
          <dd className="break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
