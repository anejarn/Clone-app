import { AlertTriangle, CalendarRange, CalendarSync, ClipboardList, FileClock, Home, IdCard, MailWarning, Siren, Tag, UserX, Wrench } from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { todayInTimeZone } from "@/lib/dates";
import { formatDate, formatDateTime, pluralize } from "@/lib/format";
import { MARRAKECH_TIMEZONE } from "@/lib/neighbourhoods";
import { dashboardCounts, expiringLicenses, LICENSE_ALERT_DAYS } from "@/lib/server/admin/dashboard";
import { requireAdminPage } from "@/lib/server/authz";
import { urgentTickets } from "@/lib/server/operations/tickets";
import { undeclaredArrivals } from "@/lib/server/declarations/travelers";
import { syncAlerts } from "@/lib/server/channels/conflicts";
import { TicketBadges } from "@/components/admin/tickets/TicketBadges";

export const metadata: Metadata = { title: "Tableau de bord" };

export default function Page() {
  return (
    <Suspense fallback={<AdminPageFallback />}>
      <Dashboard />
    </Suspense>
  );
}

const DAY = 86_400_000;

async function Dashboard() {
  const access = await requireAdminPage("/admin");
  const { user, organizationId } = access;
  const today = todayInTimeZone(MARRAKECH_TIMEZONE);
  const admin = user.role === "ADMIN";
  const [counts, alerts, urgent, undeclared, sync] = await Promise.all([
    dashboardCounts(organizationId, today),
    expiringLicenses(organizationId, today),
    urgentTickets(access),
    // Declarations are the associés' (no personal data here: counts, homes and the booking's guest name).
    admin ? undeclaredArrivals(organizationId, today, 5) : null,
    // Calendar synchronisation (Lot 7): associés only.
    admin ? syncAlerts(organizationId) : null,
  ]);

  const cards = [
    { label: "Biens", value: counts.listings, icon: Home, testId: "count-listings", note: "logements gérés" },
    { label: "Réservations à venir", value: counts.upcomingBookings, icon: CalendarRange, testId: "count-upcoming", note: "arrivées à partir d'aujourd'hui, toutes sources" },
    {
      label: "Autorisations 80-14",
      value: counts.licensesExpiring,
      icon: AlertTriangle,
      testId: "count-licenses",
      note: `expirées ou expirant sous ${LICENSE_ALERT_DAYS} jours`,
      alert: counts.licensesExpiring > 0,
    },
    { label: "Autorisations en attente", value: counts.licensesPending, icon: FileClock, testId: "count-pending", note: "biens sans numéro d'autorisation" },
    {
      label: "Tâches du jour",
      value: counts.tasksToday,
      icon: ClipboardList,
      testId: "count-tasks-today",
      note: "ménages, linge, accueils et autres",
      href: user.role === "ADMIN" ? "/admin/operations?jours=1" : "/admin/mes-taches",
    },
    {
      label: "Tâches non affectées",
      value: counts.tasksUnassigned,
      icon: UserX,
      testId: "count-tasks-unassigned",
      note: "à partir d'aujourd'hui, sans agent",
      alert: counts.tasksUnassigned > 0,
      href: user.role === "ADMIN" ? "/admin/operations?agent=aucun&jours=14" : undefined,
    },
    {
      label: "Pannes à traiter",
      value: counts.ticketsOpen,
      icon: Wrench,
      testId: "count-tickets-open",
      note: "signalées, en cours ou en attente",
      href: "/admin/pannes",
      linkLabel: "Voir les pannes",
    },
    {
      label: "Pannes urgentes",
      value: counts.ticketsUrgent,
      icon: Siren,
      testId: "count-tickets-urgent",
      note: "à traiter en priorité",
      alert: counts.ticketsUrgent > 0,
      href: "/admin/pannes?priorite=urgente",
      linkLabel: "Voir les pannes",
    },
    ...(sync
      ? [
          {
            label: "Synchronisation des calendriers",
            value: sync.openConflicts + sync.failing + sync.stale,
            icon: CalendarSync,
            testId: "count-sync-alerts",
            note: `${sync.openConflicts} conflit(s) · ${sync.failing} en erreur · ${sync.stale} non lu(s) depuis plus d'une heure`,
            alert: sync.openConflicts + sync.failing + sync.stale > 0,
            href: sync.openConflicts ? "/admin/synchronisation/conflits" : "/admin/synchronisation",
            linkLabel: "Voir la synchronisation",
          },
          {
            label: "E-mails de réservation à traiter",
            value: sync.emailsPending,
            icon: MailWarning,
            testId: "count-booking-emails",
            note: "non reconnus ou ambigus : les dates ne sont peut-être pas bloquées",
            alert: sync.emailsPending > 0,
            href: "/admin/synchronisation/emails",
            linkLabel: "Voir les e-mails",
          },
          {
            label: "Prix à reporter",
            value: sync.priceReminders,
            icon: Tag,
            testId: "count-price-reminders",
            note: "changements de prix à reporter sur les plateformes",
            alert: sync.priceReminders > 0,
            href: "/admin/synchronisation/prix",
            linkLabel: "Voir les prix",
          },
        ]
      : []),
  ];

  return (
    <AdminPage title="Tableau de bord" intro={`Bonjour ${user.name}. Situation au ${formatDate(today)}.`}>
      {urgent.length > 0 && (
        <section className="mb-6 rounded-lg border-2 border-error bg-white" aria-labelledby="urgent-title" data-testid="urgent-tickets">
          <h2 id="urgent-title" className="flex items-center gap-2 border-b border-line px-5 py-4 text-title-s font-semibold text-error">
            <Siren className="size-5" aria-hidden="true" />
            Pannes urgentes
          </h2>
          <ul className="divide-y divide-line">
            {urgent.map((t) => (
              <li key={t.id} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <Link href={`/admin/pannes/${t.id}`} className="font-semibold hover:underline">
                    {t.title}
                  </Link>
                  <p className="truncate text-caption text-ink-muted">
                    {t.listing.title} · signalée le {formatDateTime(new Date(t.createdAt))}
                  </p>
                </div>
                <TicketBadges ticket={t} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {undeclared && undeclared.count > 0 && (
        <section className="mb-6 rounded-lg border-2 border-error bg-white" aria-labelledby="undeclared-title" data-testid="undeclared-alert">
          <h2 id="undeclared-title" className="flex items-center gap-2 border-b border-line px-5 py-4 text-title-s font-semibold text-error">
            <IdCard className="size-5" aria-hidden="true" />
            Arrivées des dernières 24 h non déclarées ({undeclared.count})
          </h2>
          <ul className="divide-y divide-line">
            {undeclared.items.map((u) => (
              <li key={u.bookingId} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <Link href={`/admin/declarations/${u.bookingId}`} className="font-semibold hover:underline">
                    {u.guestName ?? "Voyageur sans nom"}
                  </Link>
                  <p className="truncate text-caption text-ink-muted">
                    {u.listingTitle} · arrivée le {formatDate(new Date(`${u.checkIn}T00:00:00Z`))} · {u.travelers ? "fiches non déclarées" : "aucune fiche voyageur"}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <p className="border-t border-line px-5 py-3">
            <Link href="/admin/declarations" className="text-caption font-semibold underline underline-offset-2">
              Voir les déclarations
            </Link>
          </p>
        </section>
      )}
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => (
          <li key={c.testId} data-testid={c.testId} className="rounded-lg border border-line bg-white p-5">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">{c.label}</p>
              <c.icon className={c.alert ? "size-5 text-error" : "size-5 text-brand"} aria-hidden="true" />
            </div>
            <p className={`mt-3 text-display font-semibold ${c.alert ? "text-error" : ""}`} data-value>
              {c.value}
            </p>
            <p className="mt-1 text-caption text-ink-muted">{c.note}</p>
            {c.href && (
              <Link href={c.href} className="mt-2 inline-block text-caption font-semibold underline underline-offset-2">
                {"linkLabel" in c ? c.linkLabel : "Voir les tâches"}
              </Link>
            )}
          </li>
        ))}
      </ul>

      <section className="mt-8 rounded-lg border border-line bg-white" aria-labelledby="licenses-title">
        <h2 id="licenses-title" className="border-b border-line px-5 py-4 text-title-s font-semibold">
          Autorisations loi 80-14 à renouveler
        </h2>
        {alerts.length === 0 ? (
          <p className="px-5 py-4 text-ink-muted">Aucune autorisation n&apos;expire dans les {LICENSE_ALERT_DAYS} prochains jours.</p>
        ) : (
          <ul className="divide-y divide-line" data-testid="license-alerts">
            {alerts.map((a) => {
              const days = Math.round((a.licenseExpiresAt.getTime() - today.getTime()) / DAY);
              const expired = days < 0;
              return (
                <li key={a.id} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{a.title}</p>
                    <p className="text-caption text-ink-muted">{a.licenseNumber ?? "Numéro inconnu"}</p>
                  </div>
                  <p className={`shrink-0 text-body ${expired ? "font-semibold text-error" : ""}`}>
                    {expired
                      ? `Expirée le ${formatDate(a.licenseExpiresAt)}`
                      : `Expire le ${formatDate(a.licenseExpiresAt)} (${days === 0 ? "aujourd'hui" : `dans ${pluralize(days, "jour", "jours")}`})`}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

    </AdminPage>
  );
}
