import { SOURCE_LABEL } from "@/lib/admin/booking-sources";
import { parseDay } from "@/lib/admin/calendar";
import { ROLE_LABEL } from "@/lib/admin/users";
import { formatDate, formatDateTime } from "@/lib/format";
import type { Role } from "@/lib/generated/prisma/enums";
import type { recentAudit } from "@/lib/server/audit";

type Entry = Awaited<ReturnType<typeof recentAudit>>[number];

const sourceOf = (v: unknown) => (typeof v === "string" && v in SOURCE_LABEL ? SOURCE_LABEL[v as keyof typeof SOURCE_LABEL] : "?");
const dayOf = (v: unknown) => {
  const d = typeof v === "string" ? parseDay(v) : null;
  return d ? formatDate(d) : "?";
};
const stayOf = (v: unknown) => {
  const r = (v ?? {}) as { checkIn?: unknown; checkOut?: unknown };
  return `du ${dayOf(r.checkIn)} au ${dayOf(r.checkOut)}`;
};

const roleOf = (v: unknown) => (typeof v === "string" && v in ROLE_LABEL ? ROLE_LABEL[v as Role].toLowerCase() : "?");

/** One line per entry of audit_logs, in French. */
function describe(e: Entry): string {
  const d = (e.details ?? {}) as Record<string, unknown>;
  const target = e.target?.name ?? (typeof d.email === "string" ? d.email : "un compte");
  switch (e.action) {
    case "invitation.created":
      return `a invité ${d.email} (${roleOf(d.role)})`;
    case "invitation.resent":
      return `a renvoyé l'invitation de ${d.email}`;
    case "invitation.revoked":
      return `a révoqué l'invitation de ${d.email}`;
    case "invitation.accepted":
      return `a accepté l'invitation (${roleOf(d.role)})`;
    case "user.role_changed":
      return `a changé le rôle de ${target} : ${roleOf(d.from)} → ${roleOf(d.to)}`;
    case "user.two_factor_reset":
      return `a réinitialisé la double authentification de ${target}`;
    case "user.deactivated":
      return `a désactivé le compte de ${target}`;
    case "user.reactivated":
      return `a réactivé le compte de ${target}`;
    case "booking.created":
      return `a saisi une réservation ${d.source === "DIRECT" ? "directe" : sourceOf(d.source)} ${stayOf(d)}${d.shortStayAccepted ? " (séjour plus court que le minimum accepté)" : ""}`;
    case "owner_block.created":
      return `a saisi un blocage propriétaire ${stayOf(d)}`;
    case "booking.dates_changed":
      return `a changé les dates : ${stayOf(d.from)} → ${stayOf(d.to)}${d.shortStayAccepted ? " (séjour plus court que le minimum accepté)" : ""}`;
    case "booking.cancelled":
      return `a annulé la réservation ${stayOf(d)}`;
    case "owner_block.cancelled":
      return `a levé le blocage propriétaire ${stayOf(d)}`;
    default:
      return e.action;
  }
}

export function AuditList({ entries }: { entries: Entry[] }) {
  if (entries.length === 0) return <p className="rounded-lg border border-line bg-white p-5 text-ink-muted">Aucune action enregistrée.</p>;
  return (
    <ul className="divide-y divide-line rounded-lg border border-line bg-white" data-testid="audit-rows">
      {entries.map((e) => (
        <li key={e.id} className="flex flex-col gap-0.5 p-3 md:flex-row md:gap-4 md:px-4">
          <time dateTime={e.createdAt.toISOString()} className="shrink-0 text-caption text-ink-muted md:w-40">
            {formatDateTime(e.createdAt)}
          </time>
          <p className="min-w-0 break-words">
            <strong>{e.actor?.name ?? "Système"}</strong> {describe(e)}
          </p>
        </li>
      ))}
    </ul>
  );
}
