import { AlertTriangle, CalendarRange, ClipboardList, FileClock, Home, UserX } from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminPage, AdminPageFallback } from "@/components/admin/AdminPage";
import { todayInTimeZone } from "@/lib/dates";
import { formatDate, pluralize } from "@/lib/format";
import { MARRAKECH_TIMEZONE } from "@/lib/neighbourhoods";
import { dashboardCounts, expiringLicenses, LICENSE_ALERT_DAYS } from "@/lib/server/admin/dashboard";
import { requireAdminPage } from "@/lib/server/authz";

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
  const { user, organizationId } = await requireAdminPage("/admin");
  const today = todayInTimeZone(MARRAKECH_TIMEZONE);
  const [counts, alerts] = await Promise.all([dashboardCounts(organizationId, today), expiringLicenses(organizationId, today)]);

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
  ];

  return (
    <AdminPage title="Tableau de bord" intro={`Bonjour ${user.name}. Situation au ${formatDate(today)}.`}>
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
                Voir les tâches
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
