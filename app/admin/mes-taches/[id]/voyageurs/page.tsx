import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { TravelerCapture } from "@/components/admin/declarations/TravelerCapture";
import { countries } from "@/lib/declarations/countries";
import { requireAdminPage } from "@/lib/server/authz";
import { travelersForCapture } from "@/lib/server/declarations/travelers";
import { AppError } from "@/lib/server/errors";
import { ID_RE } from "@/lib/server/schemas";

export const metadata: Metadata = { title: "Fiches voyageurs" };

const jjmmaaaa = (iso: string) => iso.split("-").reverse().join("/");

/**
 * The check-in screen for the travellers' documents, on a phone: the agent of a welcome task (today or tomorrow, not
 * done) records the stay's fiches and photographs the documents. Not found for anyone else (lib/declarations/access.ts);
 * once the task is done, the agent no longer sees the fiches. No document photo is ever shown here.
 */
export default function Page({ params }: PageProps<"/admin/mes-taches/[id]/voyageurs">) {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const access = await requireAdminPage("/admin/mes-taches");
  const { id } = await params;
  if (!ID_RE.test(id)) notFound();
  const data = await travelersForCapture(access, { taskId: id }).catch((e) => {
    if (e instanceof AppError && e.status === 404) return null;
    throw e;
  });
  if (!data) notFound();
  const { stay, travelers } = data;
  return (
    <AdminPage
      title={`Voyageurs · ${stay.listingTitle}`}
      intro={
        <>
          <Link href={`/admin/mes-taches/${id}`} className="underline underline-offset-2">
            Retour à la tâche
          </Link>{" "}
          · {stay.guestName ?? "Voyageur sans nom"} · du {jjmmaaaa(stay.checkIn)} au {jjmmaaaa(stay.checkOut)}
        </>
      }
    >
      <div className="space-y-5">
        <p className="rounded-lg border border-line bg-white p-4 text-caption text-ink-muted">
          Saisissez la fiche de chaque adulte (et des mineurs si besoin) d&apos;après sa pièce d&apos;identité, puis photographiez la pièce. Les données sont
          chiffrées ; vous n&apos;y aurez plus accès une fois l&apos;accueil terminé.
        </p>
        <TravelerCapture
          scope={{ taskId: id }}
          stay={stay}
          travelers={travelers}
          countries={countries()}
          canViewDocuments={false}
          writable={stay.status === "CONFIRMED"}
        />
      </div>
    </AdminPage>
  );
}
