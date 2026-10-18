import { formatDateTime } from "../format";
import type { ChannelConflictResolution, ChannelSyncOutcome, ChannelSyncTrigger } from "../generated/prisma/enums";

/** Labels of the calendar synchronisation in the back-office (Lot 7). */

export type FeedHealthKey = "NONE" | "OK" | "PENDING" | "FAILING" | "STALE";

export function feedStatus(f: { health: FeedHealthKey; lastSuccessAt: Date | null; lastError: string | null }): { tone: "ok" | "warn" | "error" | "none"; text: string } {
  const last = f.lastSuccessAt ? `dernière lecture réussie le ${formatDateTime(f.lastSuccessAt)}` : "jamais lu";
  switch (f.health) {
    case "NONE":
      return { tone: "none", text: "Import non configuré" };
    case "OK":
      return { tone: "ok", text: `Synchronisé · ${last}` };
    case "PENDING":
      return { tone: "warn", text: "En attente de la première lecture" };
    case "FAILING":
      return { tone: "error", text: `Erreur : ${f.lastError ?? "lecture impossible"} · ${last}` };
    case "STALE":
      return { tone: "error", text: `Non lu depuis plus d'une heure · ${last}${f.lastError ? ` · ${f.lastError}` : ""}` };
  }
}

export const OUTCOME_LABEL: Record<ChannelSyncOutcome, string> = { SUCCESS: "Lu", NOT_MODIFIED: "Inchangé (304)", ERROR: "Erreur" };
export const TRIGGER_LABEL: Record<ChannelSyncTrigger, string> = { SCHEDULED: "Automatique", MANUAL: "Manuel" };
export const RESOLUTION_LABEL: Record<ChannelConflictResolution, string> = {
  REPLACED: "Réservation en place annulée, import gardé",
  DISMISSED: "Marqué comme traité",
  EVENT_GONE: "Disparu du calendrier de la plateforme",
  FREED: "Dates libérées, import enregistré",
};
