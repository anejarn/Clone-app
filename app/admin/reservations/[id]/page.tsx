import { CalendarDays, CheckCircle2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { CancelForm, RescheduleForm } from "@/components/admin/bookings/BookingActions";
import { BookingDetail, bookingTitle } from "@/components/admin/bookings/BookingDetail";
import { AuditList } from "@/components/admin/users/AuditList";
import { ENTRY_KIND_LABEL, ENTRY_KINDS, type EntryKind } from "@/lib/admin/booking-form";
import { addDays, isoDay, parseDay } from "@/lib/admin/calendar";
import { canSeeBookingAmounts, canWriteBookings } from "@/lib/admin/sections";
import { getStaffBooking, staffToday } from "@/lib/server/admin/bookings";
import { recentAudit } from "@/lib/server/audit";
import { requireAdminPage } from "@/lib/server/authz";
import { ID_RE } from "@/lib/server/schemas";

export const metadata: Metadata = { title: "Réservation" };

export default function Page({ params, searchParams }: PageProps<"/admin/reservations/[id]">) {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Content params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user, organizationId } = await requireAdminPage("/admin/reservations");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  // Another organization's booking is "not found", as an unknown one.
  const b = ID_RE.test(id) ? await getStaffBooking(organizationId, id, canSeeBookingAmounts(user.role)) : null;
  if (!b) notFound();
  const canWrite = canWriteBookings(user.role);
  const created = typeof sp.cree === "string" && (ENTRY_KINDS as readonly string[]).includes(sp.cree) ? (sp.cree as EntryKind) : null;
  const history = canWrite ? await recentAudit(organizationId, { targetId: b.id }) : [];
  const editable = canWrite && b.status === "CONFIRMED" && parseDay(b.checkOut)! > staffToday();
  // The calendar opened a few days before the arrival.
  const calendarHref = `/admin/calendrier?du=${isoDay(addDays(parseDay(b.checkIn)!, -3))}`;

  return (
    <AdminPage
      title={bookingTitle(b)}
      intro={
        <>
          <Link href="/admin/reservations" className="underline underline-offset-2">
            Réservations
          </Link>{" "}
          · {b.listingTitle}
        </>
      }
    >
      <div className="space-y-5">
        {created && (
          <p role="status" className="flex items-center gap-2 rounded-lg border border-line bg-brand-tint p-4 font-medium text-brand-deep">
            <CheckCircle2 className="size-5 shrink-0" aria-hidden="true" />
            {ENTRY_KIND_LABEL[created]} enregistré{created === "blocage" ? "" : "e"} : les dates sont bloquées.
          </p>
        )}
        <section className="rounded-lg border border-line bg-white p-4 md:p-6">
          <BookingDetail booking={b} />
          <Link href={calendarHref} className="mt-5 inline-flex items-center gap-2 font-semibold underline underline-offset-2">
            <CalendarDays className="size-4" aria-hidden="true" />
            Voir dans le calendrier
          </Link>
        </section>
        {editable && (
          <div className="grid gap-5 lg:grid-cols-2">
            <RescheduleForm bookingId={b.id} source={b.source} checkIn={b.checkIn} checkOut={b.checkOut} />
            <CancelForm bookingId={b.id} source={b.source} />
          </div>
        )}
        {canWrite && (
          <section aria-labelledby="history-title">
            <h2 id="history-title" className="mb-3 text-title-s font-semibold">
              Historique
            </h2>
            <AuditList entries={history} />
          </section>
        )}
      </div>
    </AdminPage>
  );
}
