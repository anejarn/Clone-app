import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { ListingForm } from "@/components/admin/listings/ListingForm";
import { newListingFormValues } from "@/lib/admin/listing-form";
import { listingFormOptions } from "@/lib/server/admin/listings";
import { requireAdminPage } from "@/lib/server/authz";
import { createListingAction } from "../actions";

export const metadata: Metadata = { title: "Nouveau bien" };

export default function Page() {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const { organizationId } = await requireAdminPage("/admin/biens");
  const { defaultCommissionBps, ...options } = await listingFormOptions(organizationId);
  return (
    <AdminPage
      title="Nouveau bien"
      intro={
        <>
          <Link href="/admin/biens" className="underline underline-offset-2">
            Biens
          </Link>{" "}
          · La commission proposée est celle de l&apos;organisation ; elle se modifie bien par bien.
        </>
      }
    >
      <ListingForm mode="create" action={createListingAction} options={options} initial={newListingFormValues(defaultCommissionBps)} cancelHref="/admin/biens" />
    </AdminPage>
  );
}
