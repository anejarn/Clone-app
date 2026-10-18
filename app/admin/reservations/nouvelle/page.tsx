import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { EntryForm } from "@/components/admin/bookings/EntryForm";
import { ENTRY_KIND_LABEL, ENTRY_KINDS, type EntryKind } from "@/lib/admin/booking-form";
import { addDays, isoDay, parseDay } from "@/lib/admin/calendar";
import { cn } from "@/lib/cn";
import { entryListings, entryPricingRules } from "@/lib/server/admin/bookings";
import { requireAdminPage } from "@/lib/server/authz";
import { createEntryAction } from "../actions";

export const metadata: Metadata = { title: "Nouvelle saisie" };

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

const INTRO: Record<EntryKind, string> = {
  directe: "Un voyageur qui a réservé directement auprès de Sigma (téléphone, WhatsApp, e-mail) : le prix est celui du bien, saisons et événements compris, modifiable.",
  plateforme: "Une réservation prise sur une plateforme, saisie à la main en attendant la synchronisation automatique (lot 7) : la référence de la plateforme est obligatoire.",
  blocage: "Le propriétaire garde ces dates pour lui : elles ne sont plus réservables, sans voyageur ni montant.",
};

export default function Page({ searchParams }: PageProps<"/admin/reservations/nouvelle">) {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: Promise<Search> }) {
  const { organizationId } = await requireAdminPage("/admin/reservations/nouvelle");
  const sp = await searchParams;
  const kind: EntryKind = (ENTRY_KINDS as readonly string[]).includes(one(sp.type)) ? (one(sp.type) as EntryKind) : "directe";
  const [listings, rules] = await Promise.all([entryListings(organizationId), entryPricingRules(organizationId)]);
  // Pre-filled from the calendar: ?bien=<id>&du=<yyyy-MM-dd>.
  const bien = listings.some((l) => l.id === one(sp.bien)) ? one(sp.bien) : "";
  const du = parseDay(one(sp.du));
  const initial = { listingId: bien, checkIn: du ? isoDay(du) : "", checkOut: du ? isoDay(addDays(du, 1)) : "" };
  const keep = Object.fromEntries(Object.entries({ bien, du: initial.checkIn }).filter(([, v]) => v));

  return (
    <AdminPage
      title="Nouvelle saisie"
      intro={
        <>
          <Link href="/admin/reservations" className="underline underline-offset-2">
            Réservations
          </Link>{" "}
          · {INTRO[kind]}
        </>
      }
    >
      <nav aria-label="Type de saisie" className="mb-6">
        <ul className="flex flex-wrap gap-2">
          {ENTRY_KINDS.map((k) => (
            <li key={k}>
              <Link
                href={`/admin/reservations/nouvelle?${new URLSearchParams({ ...keep, type: k })}`}
                aria-current={k === kind ? "page" : undefined}
                className={cn(
                  "inline-flex h-10 items-center rounded-pill border px-4 font-medium",
                  k === kind ? "border-ink bg-ink text-white" : "border-line bg-white hover:bg-surface-2",
                )}
              >
                {ENTRY_KIND_LABEL[k]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <EntryForm key={kind} kind={kind} action={createEntryAction.bind(null, kind)} listings={listings} rules={rules} initial={initial} />
    </AdminPage>
  );
}
