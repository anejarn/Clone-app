import type { InboundEmailKind, InboundEmailStatus } from "../generated/prisma/enums";

/** Labels of the booking e-mails in the back-office (Lot 7b, Synchronisation → E-mails à traiter). */

export const EMAIL_REASON_LABEL: Record<string, string> = {
  NOT_RECOGNIZED: "plateforme non reconnue",
  NOT_A_BOOKING: "pas un e-mail de réservation",
  NOT_A_RESERVATION: "message de la plateforme sans réservation (message du voyageur, avis…)",
  NO_LISTING: "logement non reconnu",
  AMBIGUOUS_LISTING: "plusieurs logements possibles",
  NO_BOOKING: "réservation introuvable dans Sigma",
  MISSING_FIELDS: "code ou dates illisibles",
  INVALID_DATES: "dates invalides",
  UNKNOWN_KIND: "type d'e-mail non reconnu",
  AUTH_FAILED: "expéditeur non authentifié (contrôle DKIM / DMARC en échec)",
  STARTED: "annulation d'un séjour déjà commencé",
  REF_ELSEWHERE: "code déjà enregistré sur un autre bien",
  IGNORED_BY_HAND: "ignoré par un associé",
};

export const EMAIL_OUTCOME_LABEL: Record<string, string> = {
  CREATED: "Réservation créée : les dates sont bloquées.",
  CREATED_BY_HAND: "Réservation saisie à la main depuis l'e-mail.",
  ENRICHED: "Réservation complétée (code, voyageur, montant).",
  REDATED: "Réservation déplacée aux nouvelles dates.",
  REACTIVATED: "Réservation rétablie.",
  CANCELLED: "Réservation annulée : les dates sont libérées.",
  UNCHANGED: "Rien à changer : la réservation est déjà à jour.",
  PAST: "Séjour passé : rien n'a été changé.",
  CONFLICT: "Double réservation : un conflit est ouvert (Synchronisation → Conflits).",
  CONFLICT_CLOSED: "Conflit fermé : la réservation a été annulée sur la plateforme.",
  SAME_CONTENT: "Même contenu qu'un e-mail déjà reçu.",
};

export const EMAIL_KIND_LABEL: Record<InboundEmailKind, string> = {
  CONFIRMATION: "Confirmation",
  MODIFICATION: "Modification",
  CANCELLATION: "Annulation",
  UNKNOWN: "Non reconnu",
};

export const EMAIL_STATUS_LABEL: Record<InboundEmailStatus, string> = {
  PROCESSED: "Traité",
  PENDING: "À traiter",
  IGNORED: "Ignoré",
  DUPLICATE: "Doublon",
};

/** One sentence for an outcome, as shown after « Déposer un e-mail » and in the lists. */
export function emailResultText(r: { status: InboundEmailStatus; reason: string | null; outcome: string | null; duplicate?: boolean }): string {
  if (r.duplicate) return "Cet e-mail a déjà été reçu : rien de nouveau.";
  if (r.status === "PENDING") return `E-mail mis dans « E-mails à traiter » : ${EMAIL_REASON_LABEL[r.reason ?? ""] ?? "à vérifier"}.`;
  if (r.status === "IGNORED") return `E-mail ignoré : ${EMAIL_REASON_LABEL[r.reason ?? ""] ?? "pas une réservation"}.`;
  if (r.status === "DUPLICATE") return "Même contenu qu'un e-mail déjà reçu : rien de nouveau.";
  return EMAIL_OUTCOME_LABEL[r.outcome ?? ""] ?? "E-mail traité.";
}
