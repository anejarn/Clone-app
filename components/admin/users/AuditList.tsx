import { SOURCE_LABEL } from "@/lib/admin/booking-sources";
import { parseDay } from "@/lib/admin/calendar";
import { ROLE_LABEL } from "@/lib/admin/users";
import { formatDate, formatDateTime, formatMad } from "@/lib/format";
import type { Role } from "@/lib/generated/prisma/enums";
import { TASK_STATUS_LABEL, type TaskState } from "@/lib/operations/labels";
import { PARTNER_CHANNEL_LABEL, PAYMENT_METHOD_LABEL, REQUEST_STATUS_LABEL } from "@/lib/concierge/catalog";
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

const labelOf = <T extends string>(map: Record<T, string>, v: unknown) => (typeof v === "string" && v in map ? map[v as T] : "?");
const madOf = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) ? formatMad(v) : "?");

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
    case "task.created":
      return "a créé la tâche";
    case "task.assigned":
      return d.to ? "a affecté la tâche" : "a retiré l'affectation de la tâche";
    case "task.rescheduled":
      return "a changé l'horaire de la tâche";
    case "task.status_changed":
      return `a passé la tâche à « ${typeof d.to === "string" && d.to in TASK_STATUS_LABEL ? TASK_STATUS_LABEL[d.to as TaskState] : "?"} »${d.offline ? " (changement fait hors connexion)" : ""}`;
    case "guide.link_issued":
      return d.regenerated ? "a régénéré le lien du guide d'accueil (l'ancien ne fonctionne plus)" : "a créé le lien du guide d'accueil";
    case "guide.link_revoked":
      return "a révoqué le lien du guide d'accueil";
    case "guide.secrets_revealed":
      return d.via === "task" ? "a affiché les codes d'accès depuis une tâche" : "a affiché les codes d'accès du guide";
    case "guide.updated":
      return "a modifié le guide d'accueil";
    case "guide.wifi_updated":
      return "a modifié le Wi-Fi du guide";
    case "guide.code_added":
      return "a ajouté un code d'accès";
    case "guide.code_updated":
      return d.valueChanged ? "a changé un code d'accès" : "a modifié la description d'un code d'accès";
    case "guide.code_deleted":
      return "a supprimé un code d'accès";
    case "traveler.added":
      return `a enregistré une fiche voyageur${d.minor ? " (mineur)" : ""}${d.via === "task" ? " depuis l'accueil" : ""}`;
    case "traveler.updated":
      return `a modifié une fiche voyageur${d.via === "task" ? " depuis l'accueil" : ""}`;
    case "traveler.deleted":
      return "a supprimé une fiche voyageur";
    case "travelers.viewed":
      return `a consulté les fiches voyageurs (${typeof d.count === "number" ? d.count : "?"})${d.via === "task" ? " depuis l'accueil" : ""}`;
    case "traveler.document_added":
      return "a ajouté la photo d'une pièce d'identité";
    case "traveler.document_viewed":
      return "a consulté la photo d'une pièce d'identité";
    case "traveler.document_deleted":
      return "a supprimé la photo d'une pièce d'identité";
    case "travelers.declared":
      return `a marqué les voyageurs comme déclarés (${typeof d.count === "number" ? d.count : "?"})`;
    case "travelers.undeclared":
      return "a annulé la déclaration des voyageurs";
    case "identity.purged":
      return "données d'identité supprimées automatiquement (délai de conservation écoulé)";
    case "tourist_tax.closed":
      return "a clôturé la taxe de séjour";
    case "tourist_tax.reopened":
      return "a rouvert la taxe de séjour";
    case "partner.created":
      return `a ajouté le partenaire ${d.name}`;
    case "partner.updated":
      return "a modifié le partenaire";
    case "partner.deleted":
      return `a supprimé le partenaire ${d.name}`;
    case "service.created":
      return `a ajouté le service ${d.title}`;
    case "service.updated":
      return "a modifié le service";
    case "service.deleted":
      return `a supprimé le service ${d.title}`;
    case "service.photo_updated":
      return d.removed ? "a retiré la photo du service" : "a changé la photo du service";
    case "service_request.created":
      return "demande reçue depuis le guide d'accueil";
    case "service_request.sent":
      return `a transmis la demande au partenaire (${labelOf(PARTNER_CHANNEL_LABEL, d.via)})`;
    case "service_request.status_changed":
      return `a changé le statut : ${labelOf(REQUEST_STATUS_LABEL, d.from)} → ${labelOf(REQUEST_STATUS_LABEL, d.to)}`;
    case "service_request.price_set":
      return `a fixé le prix final : ${madOf((d.to as Record<string, unknown> | undefined)?.saleTotalCents)} (partenaire ${madOf((d.to as Record<string, unknown> | undefined)?.partnerTotalCents)})`;
    case "service_request.payment_recorded":
      return `a enregistré le paiement : ${madOf(d.amountCents)}, ${labelOf(PAYMENT_METHOD_LABEL, d.method).toLowerCase()}`;
    case "service_request.payment_cancelled":
      return "a annulé l'enregistrement du paiement";
    case "service_request.note_updated":
      return "a modifié la note interne";
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
