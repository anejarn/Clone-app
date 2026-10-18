import Link from "next/link";
import type { SyncAlerts } from "@/lib/server/channels/conflicts";

/**
 * The pages of Synchronisation (Lot 7): overview, conflicts, booking e-mails to handle and prices to report (7b), each
 * with its count as a badge.
 */
export function SyncTabs({ current, alerts }: { current: "apercu" | "conflits" | "emails" | "prix"; alerts: SyncAlerts }) {
  const tabs = [
    { key: "apercu", label: "Vue d'ensemble", href: "/admin/synchronisation", count: 0 },
    { key: "conflits", label: "Conflits", href: "/admin/synchronisation/conflits", count: alerts.openConflicts },
    { key: "emails", label: "E-mails à traiter", href: "/admin/synchronisation/emails", count: alerts.emailsPending },
    { key: "prix", label: "Prix à reporter", href: "/admin/synchronisation/prix", count: alerts.priceReminders },
  ] as const;
  return (
    <nav aria-label="Pages de la synchronisation" className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === current ? "page" : undefined}
          className={`-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 font-semibold ${t.key === current ? "border-ink text-ink" : "border-transparent text-ink-muted hover:text-ink"}`}
        >
          {t.label}
          {t.count > 0 && (
            <span className={`rounded-pill px-2 py-0.5 text-caption font-semibold text-white ${t.key === "prix" ? "bg-[#8a5a00]" : "bg-error"}`} data-testid={`sync-badge-${t.key}`}>
              <span className="sr-only">(</span>
              {t.count}
              <span className="sr-only">)</span>
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}
