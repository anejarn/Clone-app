import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { ListingForm } from "@/components/admin/listings/ListingForm";
import { listingToFormValues } from "@/lib/admin/listing-form";
import { getAdminListing, listingFormOptions } from "@/lib/server/admin/listings";
import { requireAdminPage } from "@/lib/server/authz";
import { ID_RE } from "@/lib/server/schemas";
import { updateListingAction } from "../../actions";

export const metadata: Metadata = { title: "Modifier un bien" };

export default function Page({ params }: PageProps<"/admin/biens/[id]/modifier">) {
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
  const listing = ID_RE.test(id) ? await getAdminListing(organizationId, id) : null;
  if (!listing) notFound();
  const { defaultCommissionBps: _d, ...options } = await listingFormOptions(organizationId);
  void _d;
  const initial = listingToFormValues({ ...listing, amenityIds: listing.amenities.map((a) => a.amenity.id) });
  return (
    <AdminPage
      title="Modifier le bien"
      intro={
        <>
          <Link href="/admin/biens" className="underline underline-offset-2">
            Biens
          </Link>{" "}
          ·{" "}
          <Link href={`/admin/biens/${listing.id}`} className="underline underline-offset-2">
            {listing.title}
          </Link>
        </>
      }
    >
      <ListingForm mode="edit" action={updateListingAction.bind(null, listing.id)} options={options} initial={initial} cancelHref={`/admin/biens/${listing.id}`} />
    </AdminPage>
  );
}
